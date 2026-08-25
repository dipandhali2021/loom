import type { NextFunction, Request, Response } from 'express';
import type { z } from 'zod';

import { Prisma } from './generated/prisma/client.ts';

type ErrorDetail = { path: string; message: string };

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetail[];

  constructor(status: number, message: string, code: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string) => new HttpError(400, message, 'bad_request');
export const unauthorized = (message = 'Authentication required.') =>
  new HttpError(401, message, 'unauthorized');
export const notFound = (message = 'Not found.') => new HttpError(404, message, 'not_found');

/** Validates a request body, turning failures into a 400 with per-field detail. */
export function parseBody<Schema extends z.ZodType>(schema: Schema, body: unknown): z.infer<Schema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(
      400,
      'Request body failed validation.',
      'invalid_body',
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Same, for query strings. */
export function parseQuery<Schema extends z.ZodType>(schema: Schema, query: unknown): z.infer<Schema> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new HttpError(
      400,
      'Query parameters failed validation.',
      'invalid_query',
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

export function routeNotFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'not_found', message: `No route for ${req.method} ${req.path}.` },
  });
}

/**
 * Terminal error handler. Express 5 forwards rejected promises from handlers here
 * automatically, so route code can be plain `async` with no wrapper.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  // P2025 = "an operation depended on a record that was required but not found".
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    res.status(404).json({ error: { code: 'not_found', message: 'Not found.' } });
    return;
  }

  console.error('[error]', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
}
