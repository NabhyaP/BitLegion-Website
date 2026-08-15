/**
 * Admin routes (§F §B3):
 *   GET  /api/v1/admin/members
 *   POST /api/v1/admin/members
 *   POST /api/v1/admin/members/import
 *   GET  /api/v1/admin/members/:userId
 *   PATCH /api/v1/admin/members/:userId
 *   DELETE /api/v1/admin/members/:userId/codeforces-link
 *   PATCH /api/v1/admin/members/:userId/roles
 *   GET  /api/v1/admin/jobs/leaderboard
 *   POST /api/v1/admin/jobs/leaderboard/retry  (returns immediately — same lock)
 *   GET  /api/v1/admin/jobs/solved-sync
 *   POST /api/v1/admin/jobs/solved-sync/user/:userId
 *   GET  /api/v1/admin/handle-issues
 *   POST /api/v1/admin/handle-issues/:userId/recheck
 *   GET  /api/v1/admin/audit-events
 *   GET  /api/v1/admin/stats
 *
 * All routes require ADMIN role. SUPERADMIN check is done in the service for
 * role mutations. Every mutation writes an audit row in the same transaction.
 */
import { Router } from 'express';
import { requireAuth, requireRole, requireRecentAuth } from '../../middleware/auth.ts';
import * as service from './service.ts';
import { pool } from '../../db/pool.ts';
import {
  listMembersQuerySchema,
  updateMemberSchema,
  createMemberSchema,
  csvRowSchema,
  patchRolesSchema,
  listAuditQuerySchema,
} from './schemas.ts';
import { badRequest, notFound } from '../../shared/errors.ts';
import * as usersRepo from '../users/repository.ts';
import { z } from 'zod';

export const adminRouter = Router();

// All admin routes require auth + ADMIN role
adminRouter.use(requireAuth, requireRole('ADMIN'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseId(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function flattenZod(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[i.path.join('.')] = i.message;
  return out;
}

// ---------------------------------------------------------------------------
// Members — list
// ---------------------------------------------------------------------------

adminRouter.get('/members', async (req, res, next) => {
  try {
    const parsed = listMembersQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query.', flattenZod(parsed.error));
    const { year, branch, status, q, page, pageSize } = parsed.data;
    const result = await service.listMembers({ year: year ?? null, branch: branch ?? null, status: status ?? null, q: q ?? null, page, pageSize });
    res.json({
      data: result.rows,
      meta: { total: result.total, page, pageSize, pages: Math.ceil(result.total / pageSize) },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Members — create single
// ---------------------------------------------------------------------------

adminRouter.post('/members', async (req, res, next) => {
  try {
    const parsed = createMemberSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid member data.', flattenZod(parsed.error));
    const user = await service.adminCreateMember(parsed.data, req.user!.id, req.requestId ?? '');
    res.status(201).json({ data: user });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Members — CSV import
// ---------------------------------------------------------------------------

adminRouter.post('/members/import', async (req, res, next) => {
  try {
    // Body: { rows: [{display_name,college_email,batch_year,branch},...] }
    const bodySchema = z.object({
      rows: z.array(csvRowSchema).min(1).max(2000),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid CSV data.', flattenZod(parsed.error));
    const result = await service.importMembersFromCsv(parsed.data.rows, req.user!.id, req.requestId ?? '');
    res.json({ data: result });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Members — get single
// ---------------------------------------------------------------------------

adminRouter.get('/members/:userId', async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) throw notFound();
    const user = await usersRepo.findById(id);
    if (!user) throw notFound();
    const roles = await usersRepo.getRoles(id);
    res.json({ data: { ...user, roles } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Members — edit
// ---------------------------------------------------------------------------

adminRouter.patch('/members/:userId', async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) throw notFound();
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid member data.', flattenZod(parsed.error));
    const user = await service.adminUpdateMember(id, parsed.data, req.user!.id, req.requestId ?? '');
    res.json({ data: user });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Members — clear CF link
// ---------------------------------------------------------------------------

adminRouter.delete('/members/:userId/codeforces-link', async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) throw notFound();
    await service.adminClearCfLink(id, req.user!.id, req.requestId ?? '');
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Members — patch roles
// ---------------------------------------------------------------------------

adminRouter.patch('/members/:userId/roles', requireRecentAuth, async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) throw notFound();
    const parsed = patchRolesSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid roles data.', flattenZod(parsed.error));
    const roles = await service.patchRoles(
      id,
      req.user!.id,
      req.roles!,
      parsed.data.grant,
      parsed.data.revoke,
      req.requestId ?? '',
    );
    res.json({ data: { roles } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Jobs — leaderboard snapshot
// ---------------------------------------------------------------------------

adminRouter.get('/jobs/leaderboard', async (req, res, next) => {
  try {
    const data = await service.getLeaderboardJobStatus();
    res.json({ data });
  } catch (err) { next(err); }
});

/**
 * POST /api/v1/admin/jobs/leaderboard/retry
 * Spawns the job as a background Node child process so it can acquire the
 * MySQL lock independently. Returns 202 immediately — never holds the HTTP
 * connection while the job runs (§B3.4).
 */
adminRouter.post('/jobs/leaderboard/retry', async (req, res, next) => {
  try {
    const { spawn } = await import('node:child_process');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const jobPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../jobs/refresh-codeforces-leaderboard.js',
    );
    // Fire-and-forget; the job handles its own MySQL lock.
    spawn(process.execPath, [jobPath], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    }).unref();

    // Audit the manual trigger
    const { record } = await import('../audit/repository.ts');
    await record({
      actorUserId: req.user!.id,
      action: 'jobs.lb-refresh.retry',
      requestId: req.requestId ?? '',
    });

    res.status(202).json({ data: { message: 'Leaderboard refresh triggered.' } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Jobs — solved sync
// ---------------------------------------------------------------------------

adminRouter.get('/jobs/solved-sync', async (req, res, next) => {
  try {
    const data = await service.getSolvedSyncJobStatus();
    res.json({ data });
  } catch (err) { next(err); }
});

adminRouter.post('/jobs/solved-sync/user/:userId', async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) throw notFound();
    await service.forceResyncUser(id, req.user!.id, req.requestId ?? '');
    res.json({ data: { message: 'Solved state reset. User will be picked up in the next sync run.' } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Handle issues (reconciliation queue)
// ---------------------------------------------------------------------------

adminRouter.get('/handle-issues', async (req, res, next) => {
  try {
    const data = await service.listHandleIssues();
    res.json({ data });
  } catch (err) { next(err); }
});

adminRouter.post('/handle-issues/:userId/recheck', async (req, res, next) => {
  try {
    const id = parseId(req.params.userId);
    if (!id) throw notFound();
    await service.recheckHandle(id, req.user!.id, req.requestId ?? '');
    res.json({ data: { message: 'Handle queued for re-check on next leaderboard refresh.' } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Audit viewer
// ---------------------------------------------------------------------------

adminRouter.get('/audit-events', async (req, res, next) => {
  try {
    const parsed = listAuditQuerySchema.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query.', flattenZod(parsed.error));
    const { actor, action, page, pageSize } = parsed.data;
    const result = await service.listAuditEvents({ actor: actor ?? null, action: action ?? null, page, pageSize });
    res.json({
      data: result.rows,
      meta: { total: result.total, page, pageSize, pages: Math.ceil(result.total / pageSize) },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

adminRouter.get('/stats', async (req, res, next) => {
  try {
    const data = await service.getStats();
    res.json({ data });
  } catch (err) { next(err); }
});
