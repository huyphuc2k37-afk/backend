/**
 * Integration tests for story routes.
 *
 * Covers:
 * - GET /api/stories (public listing, filters, pagination)
 * - GET /api/stories/:slug (story detail)
 * - View counting with signed token
 * - Rate limiting
 */
import request from "supertest";
import crypto from "crypto";
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

function makeViewToken(storyId: string, clientIP: string): string {
  const secret = process.env.VIEW_TOKEN_SECRET || process.env.NEXTAUTH_SECRET || "";
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${storyId}:${clientIP}:${ts}`;
  const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64");
  const tokenB64 = Buffer.from(payload).toString("base64");
  return `${sig}.${tokenB64}`;
}

describe("Stories — GET /api/stories", () => {
  afterEach(async () => { await resetPrisma()(); });

  it("returns paginated list of approved stories", async () => {
    const author = await createTestAuthor();
    await createTestStory(author.id, { slug: "story-a" });
    await createTestStory(author.id, { slug: "story-b" });

    const res = await request(app).get("/api/stories");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.stories)).toBe(true);
    expect(res.body.stories.length).toBeGreaterThanOrEqual(2);
  });

  it("hides pending/rejected stories from public listing", async () => {
    const author = await createTestAuthor();
    await prisma().story.create({
      data: { title: "Hidden Story", slug: `hidden-${Date.now()}`, description: "x", genre: "x", authorId: author.id, approvalStatus: "pending" },
    });

    const res = await request(app).get("/api/stories");
    const titles = res.body.stories.map((s: { title: string }) => s.title);
    expect(titles).not.toContain("Hidden Story");
  });

  it("filters by genre", async () => {
    const author = await createTestAuthor();
    await createTestStory(author.id, { genre: "Tiên hiệp", slug: `s1-${Date.now()}` });
    await createTestStory(author.id, { genre: "Kiếm hiệp", slug: `s2-${Date.now()}` });

    const res = await request(app).get("/api/stories?genre=Tiên hiệp");
    expect(res.status).toBe(200);
    expect(res.body.stories.every((s: { genre: string }) => s.genre === "Tiên hiệp")).toBe(true);
  });

  it("paginates results", async () => {
    const author = await createTestAuthor();
    for (let i = 0; i < 5; i++) {
      await createTestStory(author.id, { slug: `page-story-${Date.now()}-${i}` });
    }

    const page1 = await request(app).get("/api/stories?page=1&pageSize=2");
    const page2 = await request(app).get("/api/stories?page=2&pageSize=2");
    expect(page1.body.stories.length).toBeLessThanOrEqual(2);
    expect(page2.body.stories.length).toBeLessThanOrEqual(2);
  });
});

describe("Stories — GET /api/stories/:slug", () => {
  afterEach(async () => { await resetPrisma()(); });

  it("returns 404 for non-existent story", async () => {
    const res = await request(app).get("/api/stories/nonexistent-story-xyz");
    expect(res.status).toBe(404);
  });

  it("returns story with all chapters for approved story", async () => {
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    await createTestChapter(story.id, { number: 1 });
    await createTestChapter(story.id, { number: 2 });

    const res = await request(app).get(`/api/stories/${story.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.title).toBeDefined();
    expect(res.body.chapters.length).toBe(2);
  });

  it("returns 403 for pending story", async () => {
    const author = await createTestAuthor();
    const slug = `pending-story-${Date.now()}`;
    await prisma().story.create({
      data: { title: "Pending Story", slug, description: "x", genre: "x", authorId: author.id, approvalStatus: "pending" },
    });

    const res = await request(app).get(`/api/stories/${slug}`);
    expect(res.status).toBe(403);
  });
});

describe("Stories — view counting", () => {
  afterEach(async () => { await resetPrisma()(); });

  it("does NOT count view without a token", async () => {
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);

    await request(app).get(`/api/stories/${story.slug}`);

    // ViewLog should be empty
    const viewLog = await prisma().viewLog.findMany({ where: { storyId: story.id } });
    expect(viewLog).toHaveLength(0);
  });

  it("counts a view when valid X-View-Token is present", async () => {
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const token = makeViewToken(story.id, "192.168.1.1");

    await request(app)
      .get(`/api/stories/${story.slug}`)
      .set("X-View-Token", token)
      .set("X-Forwarded-For", "192.168.1.1");

    const viewLog = await prisma().viewLog.findMany({ where: { storyId: story.id } });
    expect(viewLog).toHaveLength(1);
  });

  it("does NOT count view with a token for a different story", async () => {
    const author = await createTestAuthor();
    const story1 = await createTestStory(author.id, { slug: `s1-${Date.now()}` });
    const story2 = await createTestStory(author.id, { slug: `s2-${Date.now()}` });

    // Token for story1, request to story2
    const token = makeViewToken(story1.id, "192.168.1.1");

    await request(app)
      .get(`/api/stories/${story2.slug}`)
      .set("X-View-Token", token)
      .set("X-Forwarded-For", "192.168.1.1");

    const viewLog1 = await prisma().viewLog.findMany({ where: { storyId: story1.id } });
    const viewLog2 = await prisma().viewLog.findMany({ where: { storyId: story2.id } });
    expect(viewLog1).toHaveLength(0); // Token was for story1
    expect(viewLog2).toHaveLength(0); // IP didn't match token IP
  });

  it("rejects a tampered token", async () => {
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);

    // Tampered token (invalid signature)
    const tamperedToken = Buffer.from(`${story.id}:192.168.1.1:999999999`).toString("base64");

    await request(app)
      .get(`/api/stories/${story.slug}`)
      .set("X-View-Token", `invalid-sig.${tamperedToken}`)
      .set("X-Forwarded-For", "192.168.1.1");

    const viewLog = await prisma().viewLog.findMany({ where: { storyId: story.id } });
    expect(viewLog).toHaveLength(0);
  });

  it("deduplicates rapid repeated views from same IP", async () => {
    const author = await createTestAuthor();
    const story = await createTestStory(author.id);
    const token = makeViewToken(story.id, "192.168.1.99");

    // Send 5 concurrent requests
    await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .get(`/api/stories/${story.slug}`)
          .set("X-View-Token", token)
          .set("X-Forwarded-For", "192.168.1.99")
      )
    );

    const viewLog = await prisma().viewLog.findMany({ where: { storyId: story.id } });
    expect(viewLog.length).toBeLessThanOrEqual(1);
  });
});

describe("Stories — rate limiting", () => {
  afterEach(async () => { await resetPrisma()(); });

  it("rate limits excessive search requests from same IP", async () => {
    // Exhaust the 30-per-minute write limiter for /api/stories
    for (let i = 0; i < 31; i++) {
      await request(app)
        .get("/api/stories")
        .set("X-Forwarded-For", `10.10.10.${i}`);
    }

    const res = await request(app)
      .get("/api/stories")
      .set("X-Forwarded-For", "10.10.10.100");
    expect(res.status).toBe(429);
  });
});
