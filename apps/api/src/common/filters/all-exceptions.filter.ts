import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface StructuredErrorResponse {
  statusCode: number;
  message: string | string[];
  correlationId: string;
  timestamp: string;
  path: string;
}

/**
 * Two responsibilities, both required by the Fase 0 Technical Plan under
 * "Observabilidad" and never implemented until now:
 *   1. Every error response has the SAME shape, regardless of whether it
 *      came from a NestJS HttpException (ValidationPipe, a service
 *      throwing NotFoundException, etc.) or an unhandled exception.
 *   2. Every error is logged with the request's correlationId, so "a
 *      customer reports booking X failed" can be traced back to the
 *      exact server-side log line via the X-Request-Id they can be asked
 *      to share — this is the answer to the Fase 0 question "qué debemos
 *      poder investigar cuando una reserva falla".
 *
 * 5xx logs the full stack (it's our bug); 4xx logs a one-line warning
 * without a stack (it's routine — a bad request, a 404, RLS-driven or
 * otherwise) so error dashboards aren't drowned in expected client
 * errors.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = this.extractMessage(exception, isHttpException);
    const correlationId = request.correlationId ?? 'unknown';

    if (status >= 500) {
      this.logger.error(
        `[${correlationId}] ${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`[${correlationId}] ${request.method} ${request.url} -> ${status}`);
    }

    const body: StructuredErrorResponse = {
      statusCode: status,
      message,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(body);
  }

  private extractMessage(exception: unknown, isHttpException: boolean): string | string[] {
    if (!isHttpException) {
      // Never leak an unhandled exception's raw message to the client —
      // it could contain internal details (a Prisma error string, a
      // stack fragment). The correlationId is how they get help, not the
      // raw error text.
      return 'Internal server error.';
    }

    const httpException = exception as HttpException;
    const body = httpException.getResponse();

    if (typeof body === 'string') return body;

    const maybeMessage = (body as { message?: string | string[] }).message;
    return maybeMessage ?? httpException.message;
  }
}
