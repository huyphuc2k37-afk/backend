import { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, ZodTypeAny } from "zod";

type Source = "body" | "query" | "params";

// Use ZodTypeAny for forward-compatibility (AnyZodObject was deprecated in zod v3)
type AnyZodLike = ZodTypeAny;

export function validate(schema: AnyZodLike, source: Source = "body"): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const data = schema.parse(req[source]);
      (req as any)[source] = data;
      next();
    } catch (err) {
      if (err instanceof ZodError) return next(err);
      next(err);
    }
  };
}

export function validateAll(schemas: {
  body?: AnyZodLike;
  query?: AnyZodLike;
  params?: AnyZodLike;
}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.body) (req as any).body = schemas.body.parse(req.body);
      if (schemas.query) (req as any).query = schemas.query.parse(req.query);
      if (schemas.params) (req as any).params = schemas.params.parse(req.params);
      next();
    } catch (err) {
      next(err);
    }
  };
}
