/**
 * Settings routes:
 *   GET  /api/v1/settings/public   — public, no auth
 *   GET  /api/v1/admin/settings    — ADMIN
 *   PATCH /api/v1/admin/settings   — ADMIN, audited
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.ts';
import * as service from './service.ts';
import { patchSettingsSchema } from './schemas.ts';
import { badRequest } from '../../shared/errors.ts';

export const settingsPublicRouter = Router();
export const settingsAdminRouter = Router();

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

settingsPublicRouter.get('/', async (_req, res, next) => {
  try {
    const data = await service.getPublicSettings();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

settingsAdminRouter.use(requireAuth, requireRole('ADMIN'));

settingsAdminRouter.get('/', async (_req, res, next) => {
  try {
    const data = await service.getAdminSettings();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

settingsAdminRouter.patch('/', async (req, res, next) => {
  try {
    const parsed = patchSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fields[issue.path.join('.')] = issue.message;
      }
      throw badRequest('Invalid settings.', fields);
    }
    const data = await service.patchSettings(parsed.data, req.user!.id, req.requestId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
});
