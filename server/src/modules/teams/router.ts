/**
 * Teams routes:
 *   GET  /api/v1/teams                                    — public
 *   POST /api/v1/admin/teams                              — ADMIN
 *   PATCH /api/v1/admin/teams/:teamId                     — ADMIN
 *   DELETE /api/v1/admin/teams/:teamId                    — ADMIN
 *   POST /api/v1/admin/teams/:teamId/members              — ADMIN
 *   PATCH /api/v1/admin/teams/:teamId/members/:memberId   — ADMIN
 *   DELETE /api/v1/admin/teams/:teamId/members/:memberId  — ADMIN
 */
import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.ts';
import * as service from './service.ts';
import {
  createTeamSchema,
  updateTeamSchema,
  createMemberSchema,
  updateMemberSchema,
} from './schemas.ts';
import { badRequest, notFound } from '../../shared/errors.ts';

export const teamsPublicRouter = Router();
export const teamsAdminRouter = Router();

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

teamsPublicRouter.get('/', async (_req, res, next) => {
  try {
    const data = await service.getTeams();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Admin — all routes require ADMIN role
// ---------------------------------------------------------------------------

teamsAdminRouter.use(requireAuth, requireRole('ADMIN'));

// Teams CRUD
teamsAdminRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createTeamSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid team data.', flattenErrors(parsed.error));
    const team = await service.adminCreateTeam(parsed.data.name, parsed.data.displayOrder, req.user!.id, req.requestId);
    res.status(201).json({ data: team });
  } catch (err) { next(err); }
});

teamsAdminRouter.patch('/:teamId', async (req, res, next) => {
  try {
    const teamId = parseId(req.params.teamId);
    if (!teamId) throw notFound('Team not found.');
    const parsed = updateTeamSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid team data.', flattenErrors(parsed.error));
    const team = await service.adminUpdateTeam(teamId, parsed.data.name, parsed.data.displayOrder, req.user!.id, req.requestId);
    res.json({ data: team });
  } catch (err) { next(err); }
});

teamsAdminRouter.delete('/:teamId', async (req, res, next) => {
  try {
    const teamId = parseId(req.params.teamId);
    if (!teamId) throw notFound('Team not found.');
    await service.adminDeleteTeam(teamId, req.user!.id, req.requestId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// Team members CRUD
teamsAdminRouter.post('/:teamId/members', async (req, res, next) => {
  try {
    const teamId = parseId(req.params.teamId);
    if (!teamId) throw notFound('Team not found.');
    const parsed = createMemberSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid member data.', flattenErrors(parsed.error));
    const d = parsed.data;
    const member = await service.adminCreateMember(
      teamId,
      { userId: d.userId, name: d.name, roleTitle: d.roleTitle, cfHandle: d.cfHandle, photoUrl: d.photoUrl, displayOrder: d.displayOrder },
      req.user!.id,
      req.requestId,
    );
    res.status(201).json({ data: member });
  } catch (err) { next(err); }
});

teamsAdminRouter.patch('/:teamId/members/:memberId', async (req, res, next) => {
  try {
    const teamId = parseId(req.params.teamId);
    const memberId = parseId(req.params.memberId);
    if (!teamId || !memberId) throw notFound('Team member not found.');
    const parsed = updateMemberSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid member data.', flattenErrors(parsed.error));
    const member = await service.adminUpdateMember(teamId, memberId, parsed.data, req.user!.id, req.requestId);
    res.json({ data: member });
  } catch (err) { next(err); }
});

teamsAdminRouter.delete('/:teamId/members/:memberId', async (req, res, next) => {
  try {
    const teamId = parseId(req.params.teamId);
    const memberId = parseId(req.params.memberId);
    if (!teamId || !memberId) throw notFound('Team member not found.');
    await service.adminDeleteMember(teamId, memberId, req.user!.id, req.requestId);
    res.status(204).end();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseId(s: string): number | null {
  const n = parseInt(s, 10);
  return isNaN(n) || n <= 0 ? null : n;
}

function flattenErrors(err: import('zod').ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) fields[issue.path.join('.')] = issue.message;
  return fields;
}
