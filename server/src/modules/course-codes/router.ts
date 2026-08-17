import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.ts';
import { badRequest } from '../../shared/errors.ts';
import * as service from './service.ts';
import { courseCodeBodySchema, courseCodeParamSchema, courseCodeUpdateSchema } from './schemas.ts';
import type { ZodError } from 'zod';

export const courseCodesPublicRouter = Router();
export const courseCodesAdminRouter = Router();

function flattenZod(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) fields[issue.path.join('.')] = issue.message;
  return fields;
}

courseCodesPublicRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ data: await service.listCourseCodes() });
  } catch (err) {
    next(err);
  }
});

courseCodesAdminRouter.use(requireAuth, requireRole('ADMIN'));

courseCodesAdminRouter.get('/', async (_req, res, next) => {
  try {
    res.json({ data: await service.listCourseCodes() });
  } catch (err) {
    next(err);
  }
});

courseCodesAdminRouter.post('/', async (req, res, next) => {
  try {
    const parsed = courseCodeBodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid course code.', flattenZod(parsed.error));
    const data = await service.createCourseCode(parsed.data, req.user!.id, req.requestId ?? '');
    res.status(201).json({ data });
  } catch (err) {
    next(err);
  }
});

courseCodesAdminRouter.patch('/:code', async (req, res, next) => {
  try {
    const code = courseCodeParamSchema.safeParse(req.params.code);
    const body = courseCodeUpdateSchema.safeParse(req.body);
    if (!code.success || !body.success) throw badRequest('Invalid course code update.');
    const data = await service.updateCourseCode(code.data, body.data, req.user!.id, req.requestId ?? '');
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

courseCodesAdminRouter.delete('/:code', async (req, res, next) => {
  try {
    const code = courseCodeParamSchema.safeParse(req.params.code);
    if (!code.success) throw badRequest('Invalid course code.');
    await service.deleteCourseCode(code.data, req.user!.id, req.requestId ?? '');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
