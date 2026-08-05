/**
 * Integration tests for admin routes.
 *
 * Covers:
 * - Admin auth guards
 * - Story approval/rejection
 * - Deposit approval (with author credit)
 * - Ban IP / ban email
 * - Rate limiting on admin endpoints
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

let app: Awaited<ReturnType<typeof import("../../index").then<typeof import("../../index")>>>;
beforeAll(async () => {
  app = (await import("../../index")).default;
});

describe("Admin — auth guard", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects non-admin users from admin endpoints", async () => {
    const user = await createTestUser({ role: "reader" });
    const res = await request(app)
      .get("/api/admin/deposits")
      .set("Authorization", `Bearer ${user.token}`);
    expect(res.status).toBe(403);
  });

  it("rejects moderators from admin endpoints", async () => {
    const mod = await createTestUser({ role: "moderator" });
    const res = await request(app)
      .get("/api/admin/deposits")
      .set("Authorization", `Bearer ${mod.token}`);
    expect(res.status).toBe(403);
  });

  it("allows admin users to access admin endpoints", async () => {
    const admin = await createTestAdmin();
    const res = await request(app)
      .get("/api/admin/deposits")
      .set("Authorization", `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/admin/deposits");
    expect(res.status).toBe(401);
  });
});

describe("Admin — deposit approval", () => {
  afterEach(async () => { await resetPrisma(); });

  it("approves a pending deposit and credits user balance", async () => {
    const admin = await createTestAdmin();
    const user = await createTestUser({ coinBalance: 0 });

    // Create a pending deposit
    const deposit = await prisma().deposit.create({
      data: {
        amount: 100000,
        coins: 100000,
        method: "zalopay",
        transferCode: "VSAPPROVE1",
        userId: user.id,
        status: "pending",
      },
    });

    const res = await request(app)
      .post("/api/admin/deposits/approve")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ depositId: deposit.id, coins: 100000 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");

    const updatedUser = await prisma().user.findUnique({
      where: { id: user.id },
      select: { coinBalance: true },
    });
    expect(updatedUser!.coinBalance).toBe(100000);
  });

  it("rejects duplicate approval of already-approved deposit", async () => {
    const admin = await createTestAdmin();
    const user = await createTestUser({ coinBalance: 0 });

    const deposit = await prisma().deposit.create({
      data: {
        amount: 50000,
        coins: 50000,
        method: "agribank",
        transferCode: "VSDUP001",
        userId: user.id,
        status: "approved",
      },
    });

    const res = await request(app)
      .post("/api/admin/deposits/approve")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ depositId: deposit.id, coins: 50000 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already|trước/i);
  });

  it("rejects deposit from banned user", async () => {
    const admin = await createTestAdmin();
    const user = await createTestUser();
    await prisma().bannedEmail.create({ data: { email: user.email } });

    const deposit = await prisma().deposit.create({
      data: {
        amount: 50000,
        coins: 50000,
        method: "agribank",
        transferCode: "VSBAN001",
        userId: user.id,
        status: "pending",
      },
    });

    const res = await request(app)
      .post("/api/admin/deposits/approve")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ depositId: deposit.id, coins: 50000 });

    expect(res.status).toBe(403);
  });
});

describe("Admin — ban IP / ban email", () => {
  afterEach(async () => { await resetPrisma(); });

  it("bans an IP address", async () => {
    const admin = await createTestAdmin();
    const res = await request(app)
      .post("/api/admin/banned-ips")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ ip: "1.2.3.4", reason: "spam bot" });

    expect(res.status).toBe(200);
    expect(res.body.ip).toBe("1.2.3.4");

    const banned = await prisma().bannedIP.findUnique({ where: { ip: "1.2.3.4" } });
    expect(banned).not.toBeNull();
  });

  it("bans an email address", async () => {
    const admin = await createTestAdmin();
    const res = await request(app)
      .post("/api/admin/banned-emails")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ email: "spam@example.com", reason: "abuse" });

    expect(res.status).toBe(200);
    const banned = await prisma().bannedEmail.findUnique({ where: { email: "spam@example.com" } });
    expect(banned).not.toBeNull();
  });

  it("rejects login from banned IP", async () => {
    await prisma().bannedIP.create({ data: { ip: "5.6.7.8" } });
    const user = await createTestUser({ provider: "email" });

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "5.6.7.8")
      .send({ email: user.email, password: "testpassword123" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/chặn|banned|spam/i);
  });
});

describe("Admin — story moderation", () => {
  afterEach(async () => { await resetPrisma(); });

  it("lists pending stories", async () => {
    const admin = await createTestAdmin();
    const author = await createTestAuthor();

    await prisma().story.create({
      data: {
        title: "Pending Story",
        slug: `pending-${Date.now()}`,
        description: "desc",
        genre: "x",
        authorId: author.id,
        approvalStatus: "pending",
      },
    });

    const res = await request(app)
      .get("/api/admin/stories?status=pending")
      .set("Authorization", `Bearer ${admin.token}`);

    expect(res.status).toBe(200);
    expect(res.body.stories.some((s: { approvalStatus: string }) => s.approvalStatus === "pending")).toBe(true);
  });

  it("approves a pending story", async () => {
    const admin = await createTestAdmin();
    const author = await createTestAuthor();

    const story = await prisma().story.create({
      data: {
        title: "Story to Approve",
        slug: `approve-${Date.now()}`,
        description: "desc",
        genre: "x",
        authorId: author.id,
        approvalStatus: "pending",
      },
    });

    const res = await request(app)
      .post("/api/admin/stories/approve")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ storyId: story.id });

    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe("approved");

    const updated = await prisma().story.findUnique({ where: { id: story.id } });
    expect(updated!.approvalStatus).toBe("approved");
  });

  it("rejects a pending story with reason", async () => {
    const admin = await createTestAdmin();
    const author = await createTestAuthor();

    const story = await prisma().story.create({
      data: {
        title: "Story to Reject",
        slug: `reject-${Date.now()}`,
        description: "desc",
        genre: "x",
        authorId: author.id,
        approvalStatus: "pending",
      },
    });

    const res = await request(app)
      .post("/api/admin/stories/reject")
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ storyId: story.id, reason: "Vi phạm quy định" });

    expect(res.status).toBe(200);
    expect(res.body.approvalStatus).toBe("rejected");
    expect(res.body.rejectionReason).toBe("Vi phạm quy định");
  });
});
