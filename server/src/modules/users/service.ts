import { badRequest, forbidden } from '../../shared/errors.ts';
import * as repo from './repository.ts';
import * as audit from '../audit/repository.ts';
import type { PatchMeInput } from './schemas.ts';
import type { User } from './types.ts';

/**
 * §B4: rollNo/batch/branch are editable exactly once, during onboarding. displayName is always
 * editable. Enforced here, not in the controller — services own business rules (§0.5).
 */
export async function patchMe(
  user: User,
  input: PatchMeInput,
  requestId: string | null = null,
): Promise<User> {
  const touchesIdentity =
    input.rollNo !== undefined || input.batchYear !== undefined || input.branch !== undefined;

  if (touchesIdentity && user.profileConfirmed) {
    throw forbidden('Roll number, batch and branch can only be set once. Contact an admin.');
  }
  if (input.displayName === undefined && !touchesIdentity && input.confirmProfile === undefined) {
    throw badRequest('No changes supplied.');
  }

  await repo.updateProfile(user.id, {
    displayName: input.displayName,
    ...(touchesIdentity
      ? { rollNo: input.rollNo, batchYear: input.batchYear, branch: input.branch }
      : {}),
    ...(input.confirmProfile ? { profileConfirmed: true } : {}),
  });

  const after = (await repo.findById(user.id))!;
  await audit.record({
    actorUserId: user.id,
    action: 'user.self_update',
    targetType: 'user',
    targetId: user.id,
    before: {
      displayName: user.displayName,
      rollNo: user.rollNo,
      batchYear: user.batchYear,
      branch: user.branch,
    },
    after: {
      displayName: after.displayName,
      rollNo: after.rollNo,
      batchYear: after.batchYear,
      branch: after.branch,
    },
    requestId,
  });
  return after;
}
