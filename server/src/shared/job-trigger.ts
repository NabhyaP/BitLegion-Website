import crypto from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env.ts';

export function hasValidJobTriggerSecret(req: Request): boolean {
  const expected = env.JOB_TRIGGER_SECRET;
  const supplied = req.get('x-job-secret');
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}
