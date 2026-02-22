import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { getJwtApiSecret } from "../lib/secrets";

export interface AuthRequest extends Request {
  user?: {
    email: string;
    name?: string;
    image?: string;
    sub?: string;
  };
}

/**
 * Middleware xác thực JWT token từ NextAuth session.
 * Frontend gửi token trong header: Authorization: Bearer <token>
 */
export function authRequired(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret = getJwtApiSecret();
    if (!secret) return res.status(500).json({ error: "Server misconfigured" });
    const decoded = jwt.verify(token, secret) as any;
    if (!decoded.email || typeof decoded.email !== "string") {
      return res.status(401).json({ error: "Invalid token: missing email" });
    }
    req.user = {
      email: decoded.email,
      name: decoded.name,
      image: decoded.picture || decoded.image,
      sub: decoded.sub,
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/**
 * Middleware tùy chọn — nếu có token thì decode, không thì bỏ qua
 */
export function authOptional(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];
  try {
    const secret = getJwtApiSecret();
    if (!secret) return next();
    const decoded = jwt.verify(token, secret) as any;
    req.user = {
      email: decoded.email,
      name: decoded.name,
      image: decoded.picture || decoded.image,
      sub: decoded.sub,
    };
  } catch {
    // Token invalid — continue without user
  }
  next();
}
