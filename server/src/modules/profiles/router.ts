/**
 * GET /api/v1/profiles/:handle
 *
 * Public, server-side only (§B4 §F).
 * Returns leaderboard-entry fields + batch/branch for the given CF handle.
 * 404 (never 403) for hidden users, suspended users, or unknown handles — no enumeration (§G).
 * No CF API calls — data comes entirely from the active leaderboard snapshot.
 */
import { Router } from 'express';
import * as lbRepo from '../leaderboards/repository.ts';

export const profilesRouter = Router();

profilesRouter.get('/:handle', async (req, res, next) => {
  try {
    const normalizedHandle = req.params.handle.toLowerCase().trim();
    if (!normalizedHandle || normalizedHandle.length > 64) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Profile not found.', requestId: req.requestId },
      });
    }

    const entry = await lbRepo.getActiveEntryByHandle(normalizedHandle);

    // 404 for: no active snapshot, handle not in snapshot, hidden user, suspended user.
    // getActiveEntryByHandle already filters show_in_leaderboard=1 AND status='ACTIVE'
    // via the JOIN — but we do NOT expose why it's missing (§G no enumeration).
    if (!entry) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Profile not found.', requestId: req.requestId },
      });
    }

    res.json({
      data: {
        userId: entry.userId,
        displayName: entry.displayName,
        handle: entry.handle,
        batch: entry.batch,
        branch: entry.branch,
        rating: entry.rating,
        maxRating: entry.maxRating,
        codeforcesRank: entry.codeforcesRank,
        solvedCount: entry.solvedCount,
        avatarUrl: entry.avatarUrl,
        profileUpdatedAt: entry.profileUpdatedAt.toISOString(),
        stale: entry.stale,
      },
    });
  } catch (err) {
    next(err);
  }
});
