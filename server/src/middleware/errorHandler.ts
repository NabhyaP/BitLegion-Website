import type { ErrorRequestHandler } from 'express';
import { AppError } from '../shared/errors.ts';

type HttpLikeError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  type?: string;
  expose?: boolean;
};

function normalizedError(err: unknown): { status: number; code: string; message: string; fields?: Record<string, string> } {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, fields: err.fields };
  }

  const candidate = err as HttpLikeError;
  const rawStatus = candidate?.status ?? candidate?.statusCode;
  const status = typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 500;

  if (candidate?.code === 'EBADCSRFTOKEN') {
    return { status: 403, code: 'EBADCSRFTOKEN', message: 'Invalid or expired CSRF token.' };
  }
  if (candidate?.type === 'entity.too.large') {
    return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  }
  if (candidate?.type === 'entity.parse.failed') {
    return { status: 400, code: 'INVALID_JSON', message: 'Request body contains invalid JSON.' };
  }

  return {
    status,
    code: typeof candidate?.code === 'string' ? candidate.code : status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
    message: status < 500 && candidate?.expose === true
      ? candidate.message
      : status >= 500 ? 'Something went wrong.' : 'Request could not be processed.',
  };
}

/** Stable API envelope for application, Express, and third-party middleware errors. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  void next;
  const normalized = normalizedError(err);
  if (normalized.status >= 500) {
    console.error({ requestId: req.requestId, err });
  }

  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      ...(normalized.fields ? { fields: normalized.fields } : {}),
      requestId: req.requestId ?? null,
    },
  });
};
