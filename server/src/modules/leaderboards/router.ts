/**
 * GET /api/v1/leaderboards/codeforces
 *
 * Public endpoint — no auth required (§F).
 * Admins get previewOnly data when leaderboard is disabled.
 * Supports ETag / 304 (§F "ETag {snapshotId}:{queryHash}").
 */
import { Router } from 'express';
import { leaderboardQuerySchema } from './schemas.ts';
import * as service from './service.ts';
import { badRequest } from '../../shared/errors.ts';
import type { RoleCode } from '../users/types.ts';

export const leaderboardRouter = Router();

leaderboardRouter.get('/codeforces', async (req, res, next) => {
  try {
    // Parse + validate query params
    const parsed = leaderboardQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const fields: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        fields[issue.path.join('.')] = issue.message;
      }
      throw badRequest('Invalid query parameters.', fields);
    }

    const q = parsed.data;

    // Determine if caller is an admin (session may not exist for public callers)
    const roles: RoleCode[] = (req as unknown as { roles?: RoleCode[] }).roles ?? [];
    const isAdmin = roles.includes('ADMIN') || roles.includes('SUPERADMIN');

    const query: service.LeaderboardQuery = {
      sort: q.sort,
      scope: q.scope,
      batch: q.batch ?? null,
      branch: q.branch ?? null,
      q: q.q ?? null,
      limit: q.limit,
      cursor: q.cursor ?? null,
      isAdmin,
    };

    // ETag: compute before fetching so we can short-circuit on 304.
    // We need the current snapshotId for this; pull it cheaply from service.
    // For simplicity: fetch data first, then set ETag header.
    // (Snapshot IDs are stable between refreshes so ETag stays valid for ~60 min.)
    const result = await service.getLeaderboard(query);

    // Disabled sentinel — no ETag needed
    if ('disabled' in result) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(result);
    }

    // Compute ETag from snapshotId + query params
    const etag = service.computeETag(result.meta.snapshotId, query);
    const ifNoneMatch = req.headers['if-none-match'];

    res.set('ETag', etag);
    res.set('Cache-Control', 'public, max-age=60');

    if (ifNoneMatch === etag) {
      return res.status(304).end();
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});
