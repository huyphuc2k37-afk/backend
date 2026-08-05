import { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

export function requestId(): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    const existing = req.headers["x-request-id"];
    req.id = typeof existing === "string" && existing.length > 0 ? existing : nanoid(12);
    res.setHeader("X-Request-Id", req.id);
    next();
  };
}

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const ms = Date.now() - start;
      const { id } = req;
      // eslint-disable-next-line no-console
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.path} -> ${res.statusCode} (${ms}ms) [${id ?? "-"}]`
      );
    });
    next();
  };
}
