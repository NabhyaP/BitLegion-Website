import type { ErrorRequestHandler } from 'express';
import { AppError } from '../shared/errors.ts';

/** Error envelope per §F. Never leaks stacks, SQL or env — those go to the log only. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = err instanceof AppError;
  const status = known ? err.status : 500;

  if (!known || status >= 500) {
    console.error({ requestId: req.requestId, err: String(err) });
  }

  res.status(status).json({
    error: {
      code: known ? err.code : 'INTERNAL_ERROR',
      message: known ? err.message : 'Something went wrong.',
      ...(known && err.fields ? { fields: err.fields } : {}),
      requestId: req.requestId ?? null,
    },
  });
};
