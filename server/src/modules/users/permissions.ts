import type { RoleCode } from './types.ts';

/** Roles an ADMIN may grant/revoke. ADMIN and SUPERADMIN are reserved for SUPERADMIN (§B1/§F). */
const ADMIN_ASSIGNABLE: RoleCode[] = ['MEMBER', 'MENTOR', 'EDITOR', 'MODERATOR'];

export type RoleChangeDenial = 'self-edit' | 'not-authorized' | 'superadmin-only';

/**
 * Pure permission check for a role grant/revoke.
 * Returns null when allowed, otherwise the reason it is denied.
 */
export function canChangeRole(params: {
  actorId: number;
  actorRoles: RoleCode[];
  targetId: number;
  role: RoleCode;
}): RoleChangeDenial | null {
  const { actorId, actorRoles, targetId, role } = params;

  // Nobody edits their own roles — including SUPERADMIN (no self-escalation, no self-lockout).
  if (actorId === targetId) return 'self-edit';

  const isSuperadmin = actorRoles.includes('SUPERADMIN');
  const isAdmin = actorRoles.includes('ADMIN');
  if (!isSuperadmin && !isAdmin) return 'not-authorized';

  // Only SUPERADMIN grants or removes ADMIN (and SUPERADMIN).
  if (role === 'ADMIN' || role === 'SUPERADMIN') return isSuperadmin ? null : 'superadmin-only';

  if (isSuperadmin) return null;
  return ADMIN_ASSIGNABLE.includes(role) ? null : 'not-authorized';
}
