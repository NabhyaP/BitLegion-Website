import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.ts';
import { badRequest } from '../../shared/errors.ts';
import * as cfRepo from '../codeforces-links/repository.ts';
import { patchMeSchema } from './schemas.ts';
import { patchMe } from './service.ts';
import type { User } from './types.ts';
import type { RoleCode } from './types.ts';

/** Public shape of the session user. Never includes roles of other users, sessions, or secrets. */
async function meResponse(user: User, roles: RoleCode[]) {
  const cfAccount = await cfRepo.findAccountByUserId(user.id);
  const codeforces =
    cfAccount && cfAccount.status !== 'UNLINKED'
      ? {
          handle: cfAccount.handle,
          status: cfAccount.status,
          verifiedAt: cfAccount.verifiedAt.toISOString(),
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
