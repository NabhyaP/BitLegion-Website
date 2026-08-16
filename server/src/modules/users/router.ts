import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.ts';
import { badRequest } from '../../shared/errors.ts';
import * as cfRepo from '../codeforces-links/repository.ts';
import * as usersRepo from './repository.ts';
import { patchMeSchema } from './schemas.ts';
import { patchMe } from './service.ts';
import type { User } from './types.ts';
import type { RoleCode } from './types.ts';

/** Public shape of the session user. Never includes roles of other users, sessions, or secrets. */
async function meResponse(user: User, roles: RoleCode[]) {
  const [cfAccount, solvedState] = await Promise.all([
    cfRepo.findAccountByUserId(user.id),
    cfRepo.getSolvedStateSummary(user.id),
  ]);
  const codeforces =
    cfAccount && cfAccount.status !== 'UNLINKED'
      ? {
          handle: cfAccount.handle,
          status: cfAccount.status,
          verifiedAt: cfAccount.verifiedAt.toISOString(),
          // solved-state summary (spec §F "/me" contract)
          solvedCount: solvedState?.solvedCount ?? null,
          lastSyncedAt: solvedState?.lastSyncedAt?.toISOString() ?? null,
        }
      : null;
  return {
    id: user.id,
    displayName: user.displayName,
    collegeEmail: user.collegeEmail, // own address only — never exposed in public endpoints
    rollNo: user.rollNo,
    batchYear: user.batchYear,
    branch: user.branch,
    status: user.status,
    showInLeaderboard: user.showInLeaderboard,
    avatarUrl: user.avatarUrl,
    profileConfirmed: user.profileConfirmed,
    roles,
    codeforces,
  };
}

export const meRouter = Router();

// ---------------------------------------------------------------------------
// Admin — user search (user-picker for teams)
// ---------------------------------------------------------------------------

export const adminUsersRouter = Router();

adminUsersRouter.get('/search', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (!q || q.length < 1) return res.json({ data: [] });
    const results = await usersRepo.searchUsers(q);
    res.json({ data: results });
  } catch (err) {
    next(err);
  }
});

meRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json({ data: await meResponse(req.user!, req.roles!) });
  } catch (err) {
    next(err);
  }
});

meRouter.patch('/', requireAuth, async (req, res, next) => {
  try {
    const parsed = patchMeSchema.safeParse(req.body);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) fields[issue.path.join('.')] = issue.message;
      throw badRequest('One or more fields are invalid.', fields);
    }
    const updated = await patchMe(req.user!, parsed.data, req.requestId ?? null);
    res.json({ data: await meResponse(updated, req.roles!) });
  } catch (err) {
    next(err);
  }
});
