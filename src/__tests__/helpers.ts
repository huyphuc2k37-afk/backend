/**
 * Test helpers — reusable utilities for integration tests.
 *
 * Usage: import { createTestApp, createTestUser, signIn } from "../helpers";
 */
import { Application } from "express";
import request, { SuperTest, Test } from "supertest";
import { sign as jwtSign } from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

// Lazy singleton so Prisma is only instantiated when tests actually run
let _prisma: PrismaClient | null = null;
export function prisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "" } },
    });
  }
  return _prisma;
}

/**
 * Reset all test data between tests.
 * Call `afterEach(async () => { await resetPrisma(); })` to ensure
 * each test starts with a clean slate.
 */
export async function resetPrisma(): Promise<void> {
  const p = prisma();
  // Delete in dependency order (children before parents)
  await p.referralEarning.deleteMany();
  await p.authorEarning.deleteMany();
  await p.platformEarning.deleteMany();
  await p.notification.deleteMany();
  await p.storyLike.deleteMany();
  await p.rating.deleteMany();
  await p.commentLike.deleteMany();
  await p.comment.deleteMany();
  await p.chapterPurchase.deleteMany();
  await p.readHistory.deleteMany();
  await p.bookmark.deleteMany();
  await p.viewLog.deleteMany();
  await p.monthlyViewStats.deleteMany();
  await p.questProgress.deleteMany();
  await p.dailyQuest.deleteMany();
  await p.withdrawal.deleteMany();
  await p.deposit.deleteMany();
  await p.storyTag.deleteMany();
  await p.chapter.deleteMany();
  await p.story.deleteMany();
  await p.follow.deleteMany();
  await p.announcement.deleteMany();
  await p.conversationParticipant.deleteMany();
  await p.message.deleteMany();
  await p.conversation.deleteMany();
  await p.tag.deleteMany();
  await p.user.deleteMany();
}

// ─── JWT helpers ──────────────────────────────────────────────

function getJwtSecret(): string {
  return process.env.JWT_API_SECRET || "test-jwt-secret-for-integration-tests-only-32chars";
}

export interface TestUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  coinBalance: number;
  passwordHash?: string;
  token: string;
  agent: SuperTest<Test>;
}

/**
 * Create a test user directly in the DB (no registration endpoint).
 */
export async function createTestUser(overrides: Partial<{
  email: string;
  name: string;
  role: Role;
  coinBalance: number;
  provider: string;
  emailVerified: boolean;
}> = {}): Promise<TestUser> {
  const email = overrides.email ?? `test-${Date.now()}@example.com`;
  const name = overrides.name ?? "Test User";
  const role = overrides.role ?? "reader";
  const coinBalance = overrides.coinBalance ?? 0;

  const passwordHash = await bcrypt.hash("testpassword123", 10);

  const user = await prisma().user.create({
    data: {
      email,
      name,
      role,
      password: passwordHash,
      provider: overrides.provider ?? "google",
      emailVerified: overrides.emailVerified ?? true,
      coinBalance,
    },
  });

  const token = jwtSign(
    { sub: user.id, email: user.email, name: user.name },
    getJwtSecret(),
    { expiresIn: "7d", algorithm: "HS256" }
  );

  const agent = request.agent(`${process.env.TEST_BACKEND_URL || "http://localhost:5000"}`);

  return { ...user, passwordHash, token, agent };
}

/**
 * Create a test user with a valid JWT token ready to use.
 */
export async function createTestAuthor(): Promise<TestUser> {
  return createTestUser({ role: "author", name: "Test Author" });
}

export async function createTestAdmin(): Promise<TestUser> {
  return createTestUser({ role: "admin", name: "Test Admin" });
}

/**
 * Create an approved story owned by a given author.
 */
export async function createTestStory(authorId: string, overrides: Partial<{
  title: string;
  slug: string;
  description: string;
  genre: string;
}> = {}): Promise<{
  id: string;
  slug: string;
}> {
  const slug = overrides.slug ?? `test-story-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const story = await prisma().story.create({
    data: {
      title: overrides.title ?? "Test Story",
      slug,
      description: overrides.description ?? "A test story description",
      genre: overrides.genre ?? "Tiên hiệp",
      authorId,
      approvalStatus: "approved",
    },
  });
  return { id: story.id, slug: story.slug };
}

/**
 * Create an approved chapter for a given story.
 */
export async function createTestChapter(
  storyId: string,
  chapterOverrides: Partial<{
    number: number;
    title: string;
    content: string;
    isLocked: boolean;
    price: number;
  }> = {}
): Promise<{ id: string; number: number }> {
  // Get current max chapter number
  const lastChapter = await prisma().chapter.findFirst({
    where: { storyId },
    orderBy: { number: "desc" },
  });
  const nextNumber = chapterOverrides.number ?? (lastChapter?.number ?? 0) + 1;

  const chapter = await prisma().chapter.create({
    data: {
      title: chapterOverrides.title ?? `Chương ${nextNumber}`,
      number: nextNumber,
      content: chapterOverrides.content ?? "<p>Nội dung chương test.</p>",
      storyId,
      approvalStatus: "approved",
      isLocked: chapterOverrides.isLocked ?? false,
      price: chapterOverrides.price ?? 0,
    },
  });
  return { id: chapter.id, number: chapter.number };
}

/** Build an auth header for a test user. */
export function authHeader(user: TestUser): Record<string, string> {
  return { Authorization: `Bearer ${user.token}` };
}

/**
 * Parse a JWT without verification — useful for tests that just need to read claims.
 */
export function parseJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  const payload = Buffer.from(parts[1], "base64").toString("utf-8");
  return JSON.parse(payload);
}
