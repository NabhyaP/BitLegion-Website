import type { RequestHandler } from 'express';
import * as users from '../modules/users/repository.ts';
import type { RoleCode, User } from '../modules/users/types.ts';
import { forbidden, unauthorized } from '../shared/errors.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      roles?: RoleCode[];
      requestId?: string;
    }
  }
}

/** Loads the session user. Suspended accounts lose access immediately, not at next login. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const id = req.session?.userId;
    if (!id) return next(unauthorized());
    const user = await users.findById(id);
    if (!user) return next(unauthorized());
    if (user.status === 'SUSPENDED') return next(forbidden('account-suspended'));
    req.user = user;
    req.roles = await users.getRoles(user.id);
    next();
  } catch (err) {
    next(err);
  }
};

/** Populate identity when a valid session exists without requiring callers to sign in. */
export const optionalAuth: RequestHandler = async (req, _res, next) => {
  try {
    const id = req.session?.userId;
    if (!id) return next();
    const user = await users.findById(id);
    if (!user || user.status === 'SUSPENDED') return next();
    req.user = user;
    req.roles = await users.getRoles(user.id);
    next();
  } catch (err) {
    next(err);
  }
};

/** Authorization is re-checked here AND in services — hiding a button is not authorization (§G). */
export function requireRole(...allowed: RoleCode[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !req.roles) return next(unauthorized());
    const ok = req.roles.some((r) => allowed.includes(r)) || req.roles.includes('SUPERADMIN');
    next(ok ? undefined : forbidden());
  };
}

const RECENT_AUTH_MS = 30 * 60 * 1000;

/** Role and CF-link changes require authentication within the last 30 minutes (§B1). */
export const requireRecentAuth: RequestHandler = (req, _res, next) => {
  const authAt = req.session?.authAt ?? 0;
  if (Date.now() - authAt > RECENT_AUTH_MS)
    return next(forbidden('Please sign in again to perform this action.'));
  next();
};
