/**
 * Settings business logic (§B3.5, §B3.1).
 * Reads and writes the settings table; emits audit events on mutations.
 */
import { pool } from '../../db/pool.ts';
import * as repo from './repository.ts';
import * as audit from '../audit/repository.ts';import { badRequest } from '../../shared/errors.ts';

export type PublicSettings = {
  announcement: string;
  leaderboardEnabled: boolean;
};

export type AdminSettings = PublicSettings & {
  leaderboardRefreshMinutes: number;
};

// ---------------------------------------------------------------------------
// Public read (no auth required)
// ---------------------------------------------------------------------------

export async function getPublicSettings(): Promise<PublicSettings> {
  const all = await repo.getAllSettings();
  return {
    announcement: all['announcement'] ?? '',
    leaderboardEnabled: (all['leaderboard_enabled'] ?? 'true') === 'true',
  };
}

// ---------------------------------------------------------------------------
// Admin read
// ---------------------------------------------------------------------------

export async function getAdminSettings(): Promise<AdminSettings> {
  const all = await repo.getAllSettings();
  return {
    announcement: all['announcement'] ?? '',
    leaderboardEnabled: (all['leaderboard_enabled'] ?? 'true') === 'true',
    leaderboardRefreshMinutes: Number(all['leaderboard_refresh_minutes'] ?? '60'),
  };
}

// ---------------------------------------------------------------------------
// Admin write — partial update, audited
// ---------------------------------------------------------------------------

export type SettingsPatch = {
  announcement?: string;
  leaderboardEnabled?: boolean;
  leaderboardRefreshMinutes?: number;
};

export async function patchSettings(
  patch: SettingsPatch,
  actorId: number,
  requestId?: string,
): Promise<AdminSettings> {
  const before = await getAdminSettings();

  if (
    patch.announcement === undefined &&
    patch.leaderboardEnabled === undefined &&
    patch.leaderboardRefreshMinutes === undefined
  ) {
    throw badRequest('No settings provided to update.');
  }

  if (
    patch.leaderboardRefreshMinutes !== undefined &&
    patch.leaderboardRefreshMinutes < 30
  ) {
    throw badRequest('leaderboardRefreshMinutes must be at least 30.', {
      leaderboardRefreshMinutes: 'Minimum 30 minutes.',
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (patch.announcement !== undefined) {
      await repo.setSetting('announcement', patch.announcement, actorId, conn);
    }
    if (patch.leaderboardEnabled !== undefined) {
      await repo.setSetting(
        'leaderboard_enabled',
        patch.leaderboardEnabled ? 'true' : 'false',
        actorId,
        conn,
      );
    }
    if (patch.leaderboardRefreshMinutes !== undefined) {
      await repo.setSetting(
        'leaderboard_refresh_minutes',
        String(patch.leaderboardRefreshMinutes),
        actorId,
        conn,
      );
    }

    await audit.record(
      {
        actorUserId: actorId,
        action: 'settings.update',
        targetType: 'settings',
        targetId: null,
        before,
        after: patch,
        requestId,
      },
      conn,
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  return getAdminSettings();
}
