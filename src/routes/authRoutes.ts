import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";
import prisma from "../lib/prisma";
import { getAuthSyncSecret, getJwtApiSecret } from "../lib/secrets";

const router = Router();

/**
 * Normalize an email address to prevent Gmail dot-trick abuse.
 * Gmail ignores dots and everything after + in the local part.
 * e.g. h.i.h.iha+spam@gmail.com → hihiha@gmail.com
 */
function normalizeEmail(email: string): string {
  const [local, domain] = email.toLowerCase().trim().split("@");
  if (!local || !domain) return email.toLowerCase().trim();
  // Only normalize Gmail (and googlemail) addresses
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const cleaned = local.replace(/\./g, "").replace(/\+.*$/, "");
    return `${cleaned}@gmail.com`;
  }
  return `${local}@${domain}`;
}

// Lazy Supabase client — only created when auth endpoints are called
let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// ─── POST /api/auth/register — đăng ký bằng email ──
router.post("/register", async (req: Request, res: Response) => {
  try {
    // Check if IP is banned
    const clientIP = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const banned = await prisma.bannedIP.findUnique({ where: { ip: clientIP } });
    if (banned) {
      return res.status(403).json({ error: "IP của bạn đã bị chặn do spam. Liên hệ admin nếu đây là nhầm lẫn." });
    }

    const { email: rawEmail, password, name: rawName } = req.body;
    const emailInput = typeof rawEmail === "string" ? rawEmail.trim() : "";
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const email = normalizeEmail(emailInput);

    // Check if email is banned
    if (email) {
      const bannedEmail = await prisma.bannedEmail.findUnique({ where: { email } });
      if (bannedEmail) {
        return res.status(403).json({ error: "Email này đã bị chặn. Liên hệ admin nếu đây là nhầm lẫn." });
      }
    }

    if (!email || !password || !name) {
      return res.status(400).json({ error: "Vui lòng điền đầy đủ thông tin" });
    }

    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({ error: "Tên phải từ 2 đến 50 ký tự" });
    }

    // Basic email format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Email không hợp lệ" });
    }

    // Only allow @gmail.com registration
    if (!email.endsWith("@gmail.com")) {
      return res.status(400).json({ error: "Chỉ chấp nhận đăng ký bằng email @gmail.com. Vui lòng dùng nút Đăng nhập với Google." });
    }

    if (password.length < 6 || password.trim().length < 6) {
      return res.status(400).json({ error: "Mật khẩu phải có ít nhất 6 ký tự (không tính khoảng trắng)" });
    }
    if (password.length > 72) {
      return res.status(400).json({ error: "Mật khẩu tối đa 72 ký tự" });
    }

    // Check if email already exists
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: "Email đã được sử dụng" });
    }

    // Sign up via Supabase Auth (sends verification email)
    const { data: supaData, error: supaError } = await getSupabase().auth.signUp({
      email,
      password,
    });

    if (supaError) {
      console.error("Supabase signup error:", supaError);
      return res.status(400).json({ error: supaError.message });
    }

    // Hash password for our DB
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user in our DB (unverified)
    // If Prisma create fails (e.g. race condition on unique email), Supabase user is orphaned
    // but user can still re-attempt login since Supabase signup is idempotent for existing emails
    try {
      await prisma.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          provider: "email",
          emailVerified: false,
        },
      });
    } catch (dbErr: any) {
      if (dbErr.code === "P2002") {
        return res.status(400).json({ error: "Email đã được sử dụng" });
      }
      throw dbErr;
    }

    res.json({
      success: true,
      message: "Đã gửi mã xác nhận đến email của bạn",
      requireVerification: true,
    });
  } catch (error) {
    console.error("Error registering:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// ─── POST /api/auth/verify — xác nhận mã OTP từ email ──
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { email: rawVerifyEmail, code } = req.body;

    if (!rawVerifyEmail || !code) {
      return res.status(400).json({ error: "Thiếu email hoặc mã xác nhận" });
    }

    const email = normalizeEmail(rawVerifyEmail);

    // Verify OTP with Supabase
    const { data, error } = await getSupabase().auth.verifyOtp({
      email,
      token: code,
      type: "signup",
    });

    if (error) {
      console.error("Supabase verify error:", error);
      return res.status(400).json({ error: "Mã xác nhận không đúng hoặc đã hết hạn" });
    }

    // Mark user as verified in our DB
    await prisma.user.update({
      where: { email },
      data: { emailVerified: true },
    });

    res.json({ success: true, message: "Xác nhận email thành công" });
  } catch (error) {
    console.error("Error verifying:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// ─── POST /api/auth/login — đăng nhập bằng email ──
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email: rawEmail, password } = req.body;

    if (!rawEmail || !password) {
      return res.status(400).json({ error: "Vui lòng nhập email và mật khẩu" });
    }

    // Check if IP is banned
    const clientIP = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const bannedIP = await prisma.bannedIP.findUnique({ where: { ip: clientIP } });
    if (bannedIP) {
      return res.status(403).json({ error: "IP của bạn đã bị chặn do spam. Liên hệ admin nếu đây là nhầm lẫn." });
    }

    const email = normalizeEmail(rawEmail);

    // Check if email is banned
    const bannedEmail = await prisma.bannedEmail.findUnique({ where: { email } });
    if (bannedEmail) {
      return res.status(403).json({ error: "Tài khoản này đã bị chặn. Liên hệ admin nếu đây là nhầm lẫn." });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    }

    // Check provider BEFORE password — Google users have password=null
    if (user.provider !== "email") {
      return res.status(400).json({
        error: "Tài khoản này sử dụng đăng nhập Google. Vui lòng dùng nút Google.",
      });
    }

    if (!user.password) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        error: "Email chưa được xác nhận. Vui lòng kiểm tra hộp thư.",
        requireVerification: true,
      });
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    }

    // Create JWT token (same format as NextAuth accessToken)
    const secret = getJwtApiSecret();
    if (!secret) return res.status(500).json({ error: "Server misconfigured" });
    const accessToken = jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        picture: user.image,
      },
      secret,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        role: user.role,
      },
      accessToken,
    });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// ─── POST /api/auth/resend — gửi lại mã xác nhận ──
router.post("/resend", async (req: Request, res: Response) => {
  try {
    const { email: rawResendEmail } = req.body;
    if (!rawResendEmail) return res.status(400).json({ error: "Thiếu email" });
    const email = normalizeEmail(rawResendEmail);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
    if (user.emailVerified) return res.json({ success: true, message: "Email đã được xác nhận" });

    const { error } = await getSupabase().auth.resend({
      type: "signup",
      email,
    });

    if (error) {
      console.error("Supabase resend error:", error);
      return res.status(400).json({ error: "Không thể gửi lại mã. Vui lòng thử lại sau." });
    }

    res.json({ success: true, message: "Đã gửi lại mã xác nhận" });
  } catch (error) {
    console.error("Error resending:", error);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// ─── POST /api/auth/sync — sync/upsert Google user and return role ──
router.post("/sync", async (req: Request, res: Response) => {
  try {
    // Check if IP is banned
    const clientIP = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const banned = await prisma.bannedIP.findUnique({ where: { ip: clientIP } });
    if (banned) {
      return res.status(403).json({ error: "IP của bạn đã bị chặn do spam." });
    }

    // Verify shared secret — only NextAuth server-side can call this
    const syncSecret = req.headers["x-sync-secret"];
    const expectedSyncSecret = getAuthSyncSecret();
    if (!syncSecret || !expectedSyncSecret || syncSecret !== expectedSyncSecret) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { email: rawEmail, name, image } = req.body;
    if (!rawEmail) return res.status(400).json({ error: "Email required" });
    const email = normalizeEmail(rawEmail);

    // Check if email is banned
    const bannedEmail = await prisma.bannedEmail.findUnique({ where: { email } });
    if (bannedEmail) {
      return res.status(403).json({ error: "Email này đã bị chặn." });
    }

    // Only allow @gmail.com for Google OAuth sync
    if (!email.endsWith("@gmail.com")) {
      return res.status(403).json({ error: "Chỉ chấp nhận tài khoản Google có email @gmail.com." });
    }

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Create user for Google OAuth
      user = await prisma.user.create({
        data: {
          email,
          name: name || email.split("@")[0],
          image: image || null,
          provider: "google",
          emailVerified: true,
          role: "reader",
        },
      });
    }

    res.json({
      user: {
        id: user.id,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error syncing user:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
