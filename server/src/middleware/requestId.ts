import type { RequestHandler } from 'express';
import { randomUUID } from 'node:crypto';

export const requestId: RequestHandler = (req, res, next) => {
  req.requestId = `req_${randomUUID()}`;
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
