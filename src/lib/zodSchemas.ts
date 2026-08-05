import { z } from "zod";

// Common primitives
export const positiveInt = z.coerce.number().int().positive();
export const nonEmpty = (max = 500) =>
  z.string().trim().min(1, "Trường này là bắt buộc").max(max);
export const slug = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug chỉ gồm chữ thường, số, dấu gạch ngang");

// Auth
export const registerSchema = z.object({
  name: nonEmpty(80),
  email: z.string().trim().toLowerCase().email("Email không hợp lệ"),
  password: z.string().min(8, "Mật khẩu tối thiểu 8 ký tự").max(120),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

// Story
export const storyCreateSchema = z.object({
  title: nonEmpty(200),
  description: z.string().max(5000).optional().default(""),
  genre: z.string().max(300).optional().default(""),
  coverUrl: z.string().url().optional().or(z.literal("")),
  tags: z.array(z.string()).optional(),
});

export const chapterCreateSchema = z.object({
  storyId: z.string().min(1),
  title: nonEmpty(200),
  content: z.string().min(1).max(500_000),
  price: z.coerce.number().int().min(0).max(100000).default(0),
  authorNote: z.string().max(2000).optional(),
});

// Wallet
export const depositCreateSchema = z.object({
  amount: z.coerce.number().int().min(1000, "Tối thiểu 1.000 VND").max(100_000_000),
  method: z.enum(["bank", "momo", "vnpay", "manual"]),
  proofImage: z.string().url().optional(),
});

export const tipSchema = z.object({
  chapterId: z.string().min(1),
  coins: z.coerce.number().int().min(10).max(50_000),
});

// Comment
export const commentCreateSchema = z.object({
  chapterId: z.string().min(1).optional(),
  paragraphIndex: z.coerce.number().int().min(0).optional(),
  content: nonEmpty(1000),
});

// Generic id param
export const idParamSchema = z.object({ id: z.string().min(1) });
