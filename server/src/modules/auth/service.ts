// Steps 2–8 of the §B1 callback, as one testable function. Token/state/nonce/PKCE verification
// (step 1) happens in the controller, which hands verified claims to signInWithGoogleClaims.
import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../../db/pool.ts';
import { env, superadminEmails } from '../../config/env.ts';
import { isCollegeEmail, parseCollegeEmail } from '../users/rollno.ts';
import * as users from '../users/repository.ts';
import * as audit from '../audit/repository.ts';
import type { User } from '../users/types.ts';

export type GoogleClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

/** Redirect targets are the spec's error codes — never raw messages (§B1). */
export type SignInFailure = 'not-college-email' | 'account-suspended' | 'oauth-failure';

export class SignInError extends Error {
  // Plain field, not a parameter property — Node's strip-only TS mode rejects those.
  readonly reason: SignInFailure;
  constructor(reason: SignInFailure) {
    super(reason);
    this.reason = reason;
  }
}

export type SignInResult = { user: User; isNew: boolean };

export async function signInWithGoogleClaims(
  claims: GoogleClaims,
  requestId: string | null = null,
): Promise<SignInResult> {
  // 2. Reject unless the provider asserts a verified email.
  if (claims.email_verified !== true || !claims.email) throw new SignInError('not-college-email');

  // 3–4. Normalize, then the suffix check IS the enforcement (the `hd` claim is unreliable).
  const email = claims.email.toLowerCase().trim();
  if (!isCollegeEmail(email, env.ALLOWED_EMAIL_SUFFIX)) throw new SignInError('not-college-email');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 5. Known google_sub, else a pre-provisioned row matched by college_email.
    let user = await users.findByGoogleSub(claims.sub, conn);
    let isNew = false;

    if (!user) {
      const preProvisioned = await users.findByEmail(email, conn);
      if (preProvisioned) {
        if (preProvisioned.googleSub && preProvisioned.googleSub !== claims.sub) {
          // Same college address already bound to a different Google account.
          throw new SignInError('oauth-failure');
        }
        await users.attachGoogleSub(preProvisioned.id, claims.sub, claims.picture ?? null, conn);
        await audit.record(
          {
            actorUserId: preProvisioned.id,
            action: 'user.activate',
            targetType: 'user',
            targetId: preProvisioned.id,
            before: { status: preProvisioned.status },
            after: { status: 'ACTIVE' },
            requestId,
          },
          conn,
        );
        user = (await users.findById(preProvisioned.id, conn))!;
      } else {
        // 6. Create from the parsed local-part.
        const parsed = parseCollegeEmail(email, env.ALLOWED_EMAIL_SUFFIX);
        // Course code wins over the subdomain when it is configured; falls back to the subdomain.
        const mapped = parsed.courseCode
          ? await users.branchForCourseCode(parsed.courseCode, conn)
          : null;
        const id = await users.createUser(
          {
            googleSub: claims.sub,
            collegeEmail: email,
            displayName: claims.name?.trim() || email.split('@')[0]!,
            rollNo: parsed.rollNo,
            batchYear: parsed.batchYear,
            branch: mapped ?? parsed.branch,
            avatarUrl: claims.picture ?? null,
          },
          conn,
        );
        await users.grantRole(id, 'MEMBER', null, conn);
        await audit.record(
          { actorUserId: id, action: 'user.create', targetType: 'user', targetId: id, requestId },
          conn,
        );
        user = (await users.findById(id, conn))!;
        isNew = true;
      }
    }

    // 7. Suspended accounts never get a session.
    if (user.status === 'SUSPENDED') throw new SignInError('account-suspended');

    // Everyone gets MEMBER (idempotent for pre-provisioned rows).
    await users.grantRole(user.id, 'MEMBER', null, conn);

    // 8. Seed superadmins by email.
    if (superadminEmails.includes(user.collegeEmail)) {
      const roles = await users.getRoles(user.id, conn);
      if (!roles.includes('SUPERADMIN')) {
        await users.grantRole(user.id, 'SUPERADMIN', null, conn);
        await audit.record(
          {
            actorUserId: user.id,
            action: 'role.grant',
            targetType: 'user',
            targetId: user.id,
            after: { role: 'SUPERADMIN', via: 'SEED_SUPERADMIN_EMAILS' },
            requestId,
          },
          conn,
        );
      }
    }

    await conn.commit();
    return { user, isNew };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
