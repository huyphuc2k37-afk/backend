import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

export interface ApiError extends Error {
  status?: number;
  code?: string;
  details?: unknown;
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code ?? `HTTP_${status}`;
    this.details = details;
    this.name = "HttpError";
  }

  static badRequest(message = "Bad request", details?: unknown) {
    return new HttpError(400, message, "BAD_REQUEST", details);
  }
  static unauthorized(message = "Unauthorized") {
    return new HttpError(401, message, "UNAUTHORIZED");
  }
  static forbidden(message = "Forbidden") {
    return new HttpError(403, message, "FORBIDDEN");
  }
  static notFound(message = "Not found") {
    return new HttpError(404, message, "NOT_FOUND");
  }
  static conflict(message = "Conflict", details?: unknown) {
    return new HttpError(409, message, "CONFLICT", details);
  }
  static internal(message = "Internal server error") {
    return new HttpError(500, message, "INTERNAL_ERROR");
  }
}

// Centralized error responder
export function errorHandler(
  err: ApiError | Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const requestId = (req as any).id ?? "unknown";

  // Zod validation errors
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: err.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
        code: i.code,
      })),
      requestId,
    });
    return;
  }

  // Prisma known errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: "Resource already exists",
        code: "DUPLICATE_ENTRY",
        details: { target: (err.meta as any)?.target },
        requestId,
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({
        error: "Resource not found",
        code: "NOT_FOUND",
        requestId,
      });
      return;
    }
  }

  // Our own HTTP errors
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
      requestId,
    });
    return;
  }

  // Default unknown error
  // eslint-disable-next-line no-console
  console.error(`[ERROR] [${requestId}]`, err);
  res.status(500).json({
    error: "Internal server error",
    code: "INTERNAL_ERROR",
    requestId,
  });
}

// 404 handler for unknown routes
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code: "ROUTE_NOT_FOUND",
  });
}

export function asyncHandler<T extends Request, U extends Response>(
  fn: (req: T, res: U, next: NextFunction) => Promise<unknown>
) {
  return (req: T, res: U, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
