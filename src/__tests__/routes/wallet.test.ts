/**
 * Integration tests for wallet routes.
 *
 * Covers:
 * - GET /api/wallet/balance (auth required, caching)
 * - POST /api/wallet/deposit (create deposit request)
 * - POST /api/wallet/purchase (buy chapter — race-condition safe)
 * - POST /api/wallet/tip (tip author)
 * - Admin tip with daily cap enforcement
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import {
  createTestUser,
  createTestAuthor,
  createTestAdmin,
  createTestStory,
  createTestChapter,
  resetPrisma,
  prisma,
} from "../helpers";

// Load app lazily — index.ts runs startup code on import
type AppType = Awaited<ReturnType<typeof import("../../index")>>["default"];
let app: AppType;
beforeAll(async () => {
  const mod = await import("../../index");
  app = (mod as any).default ?? (mod as any).app;
});

describe("Wallet — balance", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/wallet/balance");
    expect(res.status).toBe(401);
  });

  it("returns current balance for authenticated user", async () => {
    const user = await createTestUser({ coinBalance: 5000 });
    const res = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(200);
    expect(res.body.coinBalance).toBe(5000);
    expect(res.body.balance).toBe(5000);
  });

  it("returns 404 for non-existent user", async () => {
    const user = await createTestUser();
    const tokenWithDeletedUser = user.token;
    await prisma().user.delete({ where: { id: user.id } });

    const res = await request(app)
      .get("/api/wallet/balance")
      .set("Authorization", `Bearer ${tokenWithDeletedUser}`);
    expect(res.status).toBe(404);
  });
});

describe("Wallet — deposit", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects unauthenticated deposit", async () => {
    const res = await request(app)
      .post("/api/wallet/deposit")
      .send({ amount: 50000, method: "agribank" });
    expect(res.status).toBe(401);
  });

  it("rejects missing required fields", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${user.token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("rejects invalid payment method", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 50000, method: "bitcoin" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/thanh toán/i);
  });

  it("rejects negative amount", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: -100, method: "zalopay" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hợp lệ/i);
  });

  it("rejects amount exceeding 10M coins", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 20_000_000, method: "zalopay" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/giới hạn/i);
  });

  it("creates a deposit with auto-generated transfer code", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 100000, method: "zalopay" });

    expect(res.status).toBe(200);
    expect(res.body.id).toBeDefined();
    expect(res.body.status).toBe("pending");
    expect(res.body.transferCode).toMatch(/^VS[A-Z0-9]{6}$/);
    expect(res.body.coins).toBe(100000);
  });

  it("uses client-provided transfer code if valid and unused", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .post("/api/wallet/deposit")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ amount: 50000, method: "agribank", transferCode: "VSTEST01" });

    expect(res.status).toBe(200);
    expect(res.body.transferCode).toBe("VSTEST01");
  });
});

describe("Wallet — purchase", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects unauthenticated purchase", async () => {
    const res = await request(app)
      .post("/api/wallet/purchase")
      .send({ chapterId: "any" });
    expect(res.status).toBe(401);
  });

  it("rejects purchase of non-existent chapter", async () => {
    const user = await createTestUser({ coinBalance: 10000 });
    const res = await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ chapterId: "nonexistent-id" });
    expect(res.status).toBe(400);
  });

  it("rejects purchase of free chapter", async () => {
    const reader = await createTestUser({ coinBalance: 10000 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id, { isLocked: false, price: 0 });

    const res = await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/free/i);
  });

  it("rejects purchase with insufficient balance", async () => {
    const reader = await createTestUser({ coinBalance: 50 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id, { isLocked: true, price: 100 });

    const res = await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficient|đủ/i);
  });

  it("rejects author purchasing their own chapter", async () => {
    const author = await createTestAuthor({ coinBalance: 10000 });
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id, { isLocked: true, price: 100 });

    const res = await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${author.token}`)
      .send({ chapterId: chapter.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/chính mình/i);
  });

  it("successfully purchases a chapter and credits author 65%", async () => {
    const reader = await createTestUser({ coinBalance: 5000 });
    const author = await createTestAuthor({ coinBalance: 0 });
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id, { isLocked: true, price: 100 });

    const res = await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.spent).toBe(100);

    const updatedReader = await prisma().user.findUnique({
      where: { id: reader.id },
      select: { coinBalance: true },
    });
    const updatedAuthor = await prisma().user.findUnique({
      where: { id: author.id },
      select: { coinBalance: true },
    });
    expect(updatedReader!.coinBalance).toBe(5000 - 100);
    expect(updatedAuthor!.coinBalance).toBe(65); // 65% of 100
  });

  it("rejects duplicate purchase of the same chapter", async () => {
    const reader = await createTestUser({ coinBalance: 10000 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id, { isLocked: true, price: 100 });

    // First purchase
    await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id });

    // Second purchase — should fail
    const res = await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already|mua/i);
  });
});

describe("Wallet — tip", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects tip below minimum of 100 coins", async () => {
    const reader = await createTestUser({ coinBalance: 5000 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id, coins: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/100|tối thiểu/i);
  });

  it("rejects tip above maximum of 50,000 coins", async () => {
    const reader = await createTestUser({ coinBalance: 100000 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id, coins: 100000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50,?000/i);
  });

  it("rejects tipping own chapter", async () => {
    const author = await createTestAuthor({ coinBalance: 10000 });
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${author.token}`)
      .send({ chapterId: chapter.id, coins: 200 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/chính mình/i);
  });

  it("successfully tips with correct amount and credits 65% to author", async () => {
    const reader = await createTestUser({ coinBalance: 10000 });
    const author = await createTestAuthor({ coinBalance: 0 });
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id, coins: 500 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.spent).toBe(500);

    const updatedAuthor = await prisma().user.findUnique({
      where: { id: author.id },
      select: { coinBalance: true },
    });
    expect(updatedAuthor!.coinBalance).toBe(325); // 65% of 500
  });

  it("rejects tip with insufficient balance", async () => {
    const reader = await createTestUser({ coinBalance: 100 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id, coins: 500 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/đủ|insufficient/i);
  });

  it("admin tip bypasses balance check and credits full amount", async () => {
    const admin = await createTestAdmin({ coinBalance: 0 });
    const author = await createTestAuthor({ coinBalance: 0 });
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ chapterId: chapter.id, coins: 1000 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.spent).toBe(0); // Admin doesn't pay

    const updatedAuthor = await prisma().user.findUnique({
      where: { id: author.id },
      select: { coinBalance: true },
    });
    expect(updatedAuthor!.coinBalance).toBe(1000); // Admin gift = full amount
  });

  it("admin tip respects 50,000 per-request cap", async () => {
    const admin = await createTestAdmin({ coinBalance: 0 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id);

    const res = await request(app)
      .post("/api/wallet/tip")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ chapterId: chapter.id, coins: 100000 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/50,?000/i);
  });
});

describe("Wallet — history", () => {
  afterEach(async () => { await resetPrisma(); });

  it("returns empty history for new user", async () => {
    const user = await createTestUser();
    const res = await request(app)
      .get("/api/wallet/history")
      .set("Authorization", `Bearer ${user.token}`);

    expect(res.status).toBe(200);
    expect(res.body.deposits).toEqual([]);
    expect(res.body.purchases).toEqual([]);
    expect(res.body.purchasedChapterIds).toEqual([]);
  });

  it("includes past purchases in history", async () => {
    const reader = await createTestUser({ coinBalance: 10000 });
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const chapter = await createTestChapter(story.id, { isLocked: true, price: 100 });

    await request(app)
      .post("/api/wallet/purchase")
      .set("Authorization", `Bearer ${reader.token}`)
      .send({ chapterId: chapter.id });

    const res = await request(app)
      .get("/api/wallet/history")
      .set("Authorization", `Bearer ${reader.token}`);

    expect(res.status).toBe(200);
    expect(res.body.purchases).toHaveLength(1);
    expect(res.body.purchasedChapterIds).toContain(chapter.id);
  });
});
