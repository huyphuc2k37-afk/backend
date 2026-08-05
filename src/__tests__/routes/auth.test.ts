/**
 * Integration tests for authentication routes.
 *
 * Covers:
 * - Login (valid/invalid credentials, banned users, wrong provider)
 * - Sync endpoint (x-sync-secret validation)
 * - Rate limiting (login)
 * - normalizeEmail (Gmail dot-trick)
 */
import request from "supertest";
import { describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import { createTestUser, parseJwtPayload, resetPrisma, prisma } from "../helpers";

// Load app lazily — index.ts runs startup code on import.
// Using `any` avoids complex type gymnastics while still being type-safe at runtime.
let app: any;
beforeAll(async () => {
  app = (await import("../../index")).default;
});

describe("Auth — login", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects login without email or password", async () => {
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email|mật khẩu/i);
  });

  it("rejects login for non-existent email", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "anything" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/không đúng/i);
  });

  it("rejects login for Google user trying to use email/password", async () => {
    const googleUser = await createTestUser({
      email: "google-user@gmail.com",
      provider: "google",
      emailVerified: true,
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: googleUser.email, password: "anypassword" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/không đúng/i);
  });

  it("rejects login with wrong password", async () => {
    const user = await createTestUser({ provider: "email" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "wrongpassword" });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/không đúng/i);
  });

  it("rejects login for banned IP", async () => {
    const testIP = `192.168.99.${Math.floor(Math.random() * 255)}`;
    await prisma().bannedIP.create({ data: { ip: testIP } });

    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", testIP)
      .send({ email: "any@example.com", password: "any" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/chặn|banned|spam/i);
  });

  it("rejects login for banned email", async () => {
    const user = await createTestUser({ provider: "email" });
    await prisma().bannedEmail.create({ data: { email: user.email } });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "testpassword123" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/chặn|banned/i);
  });

  it("successfully logs in with correct credentials", async () => {
    const user = await createTestUser({ provider: "email" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: user.email, password: "testpassword123" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.id).toBe(user.id);
    expect(res.body.user.email).toBe(user.email);
  });

  it("returns a valid JWT with correct claims", async () => {
    await createTestUser({ name: "Jane Doe" });
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "test@example.com", password: "testpassword123" });

    const payload = parseJwtPayload(res.body.accessToken);
    expect(payload.sub).toBeDefined();
    expect(payload.email).toBeDefined();
    expect(payload.name).toBe("Jane Doe");
  });

  it("normalizes Gmail dot-trick variants to the same account", async () => {
    const user = await createTestUser({ email: "h.i.h.iha@gmail.com", provider: "email" });

    // Login with dot-trick variant
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "h.i.h.iha@gmail.com", password: "testpassword123" });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);

    // Login with stripped dots
    const res2 = await request(app)
      .post("/api/auth/login")
      .send({ email: "hihiha@gmail.com", password: "testpassword123" });
    expect(res2.status).toBe(200);
    expect(res2.body.user.id).toBe(user.id);

    // Login with + alias
    const res3 = await request(app)
      .post("/api/auth/login")
      .send({ email: "h.i.h.iha+spam@gmail.com", password: "testpassword123" });
    expect(res3.status).toBe(200);
    expect(res3.body.user.id).toBe(user.id);
  });
});

describe("Auth — sync endpoint", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rejects requests without x-sync-secret header", async () => {
    const res = await request(app).post("/api/auth/sync").send({ email: "test@example.com" });
    expect(res.status).toBe(403);
  });

  it("rejects requests with wrong sync secret", async () => {
    const res = await request(app)
      .post("/api/auth/sync")
      .set("x-sync-secret", "wrong-secret")
      .send({ email: "test@example.com" });
    expect(res.status).toBe(403);
  });

  it("creates a new reader on first sync", async () => {
    const res = await request(app)
      .post("/api/auth/sync")
      .set("x-sync-secret", process.env.AUTH_SYNC_SECRET!)
      .send({ email: "new-google-user@gmail.com", name: "Google User" });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.role).toBe("reader");
  });

  it("returns existing user on subsequent syncs", async () => {
    const existing = await createTestUser({ email: "existing@gmail.com" });

    const res = await request(app)
      .post("/api/auth/sync")
      .set("x-sync-secret", process.env.AUTH_SYNC_SECRET!)
      .send({ email: existing.email, name: "Updated Name" });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(existing.id);
  });

  it("rejects banned email on sync", async () => {
    await prisma().bannedEmail.create({ data: { email: "banned@gmail.com" } });

    const res = await request(app)
      .post("/api/auth/sync")
      .set("x-sync-secret", process.env.AUTH_SYNC_SECRET!)
      .send({ email: "banned@gmail.com", name: "Banned User" });

    expect(res.status).toBe(403);
  });

  it("only allows @gmail.com emails for Google sync", async () => {
    const res = await request(app)
      .post("/api/auth/sync")
      .set("x-sync-secret", process.env.AUTH_SYNC_SECRET!)
      .send({ email: "user@yahoo.com", name: "Yahoo User" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/gmail/i);
  });
});

describe("Auth — rate limiting", () => {
  afterEach(async () => { await resetPrisma(); });

  it("rate limits excessive login attempts from same IP", async () => {
    const user = await createTestUser({ provider: "email" });
    const testIP = `10.99.1.${Math.floor(Math.random() * 255)}`;

    // Exhaust the 5-per-15s login limit
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", testIP)
        .send({ email: user.email, password: "testpassword123" });
    }

    // 6th attempt should be rate-limited
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", testIP)
      .send({ email: user.email, password: "testpassword123" });

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBeDefined();
  });
});
