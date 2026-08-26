import type { Response } from 'express';

/**
 * Server-sent events, as both streaming routes emit them.
 *
 * Shared rather than written twice because the headers are the load-bearing part:
 * a missing `X-Accel-Buffering` or `no-transform` does not fail, it just quietly
 * turns a streamed reply into one late block, and a second copy of them is a
 * second place for that to drift.
 */

/** Commits the response as an event stream. Nothing may be written before this. */
export function openStream(res: Response): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tells nginx-style proxies not to buffer, which would defeat streaming entirely.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

/** One frame. Newlines inside the payload are safe: JSON escapes them. */
export function send(res: Response, event: Record<string, unknown>): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
