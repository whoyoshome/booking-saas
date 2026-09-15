import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
  }
}

/**
 * Reuses an incoming X-Request-Id (e.g. from a load balancer or an
 * upstream service in a future microservice split) when present, so a
 * request can be traced across hops; generates a fresh UUID otherwise.
 * Always echoed back on the response header, so a client (or a person
 * debugging with curl -i) can report the exact ID tied to a failure —
 * this is what AllExceptionsFilter logs alongside every error.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const correlationId = incoming && incoming.length > 0 ? incoming : randomUUID();
    req.correlationId = correlationId;
    res.setHeader('X-Request-Id', correlationId);
    next();
  }
}
