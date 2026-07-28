import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { MetricsService } from './metrics.service.js';

const UUID_PATH_SEGMENT =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi;
const KNOWN_PATHS = new Set([
  '/healthz',
  '/metrics',
  '/readyz',
  '/v1/games/:id/snapshot',
  '/v1/games/active',
  '/v1/session',
  '/v1/session/renew',
  '/v1/session/reset',
]);

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = performance.now();
    response.once('finish', () => {
      const labels = {
        method: request.method,
        path: this.boundedPath(request.path),
        status: String(response.statusCode),
      };
      this.metrics.increment(
        'cluchess_http_requests_total',
        'HTTP requests by method, bounded path, and response status.',
        labels,
      );
      this.metrics.observe(
        'cluchess_http_request_duration_seconds',
        'HTTP request duration by method and bounded path.',
        (performance.now() - startedAt) / 1000,
        { method: labels.method, path: labels.path },
      );
    });
    next();
  }

  private boundedPath(path: string): string {
    const normalized = path.replace(UUID_PATH_SEGMENT, '/:id');
    return KNOWN_PATHS.has(normalized) ? normalized : '/other';
  }
}
