import type { RequestHandler } from 'express';
import { forbidden } from '../shared/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isAllowedOrigin(origin: string, appUrl: string): boolean {
  try {
    return new URL(origin).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

export function enforceSameOrigin(appUrl: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    if (origin && !isAllowedOrigin(origin, appUrl)) {
      return next(forbidden('Cross-origin state-changing requests are not allowed.'));
    }

    if (!origin && req.get('sec-fetch-site') === 'cross-site') {
      return next(forbidden('Cross-origin state-changing requests are not allowed.'));
    }

    return next();
  };
}
