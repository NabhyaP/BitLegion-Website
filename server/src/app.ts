import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.ts';
import { dbReachable, pool } from './db/pool.ts';
import { getActiveVersionCompletedAt } from './modules/leaderboards/repository.ts';
import { requestId } from './middleware/requestId.ts';
import { sessionMiddleware } from './middleware/session.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { authRouter } from './modules/auth/router.ts';
import { meRouter } from './modules/users/router.ts';
import { cfLinksRouter } from './modules/codeforces-links/router.ts';
import { leaderboardRouter } from './modules/leaderboards/router.ts';
import { settingsPublicRouter, settingsAdminRouter } from './modules/settings/router.ts';
import { teamsPublicRouter, teamsAdminRouter } from './modules/teams/router.ts';
import { profilesRouter } from './modules/profiles/router.ts';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Process-local buckets (§F). Sufficient for a single Hostinger Node process.
const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true });
const readLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true });
const adminLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true });
// CF link attempts: 5/min/user (§F "link 5/min/user").
const linkLimiter = rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true });

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Hostinger terminates TLS in front of Node

  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          connectSrc: ["'self'", 'https://codeforces.com'],
          imgSrc: ["'self'", 'https:', 'data:'],
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware());

  app.get('/api/v1/health', async (_req, res) => {
    const database = (await dbReachable()) ? 'ok' : 'down';
    // Fetch the active snapshot's completed_at; returns null if no snapshot has been published.
    let activeLeaderboardGeneratedAt: string | null = null;
    if (database === 'ok') {
      try {
        const ts = await getActiveVersionCompletedAt();
        activeLeaderboardGeneratedAt = ts ? ts.toISOString() : null;
      } catch {
        // Non-fatal: leaderboard tables may not exist yet in a fresh deployment.
      }
    }
    res.json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      activeLeaderboardGeneratedAt,
      version: process.env.GIT_SHA ?? 'dev',
    });
  });

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/me', writeLimiter, meRouter);
  app.use('/api/v1/codeforces', linkLimiter, cfLinksRouter);

  // Phase 4 — public read surface
  app.use('/api/v1/leaderboards', readLimiter, leaderboardRouter);
  app.use('/api/v1/settings/public', readLimiter, settingsPublicRouter);
  app.use('/api/v1/teams', readLimiter, teamsPublicRouter);
  app.use('/api/v1/profiles', readLimiter, profilesRouter);

  // Phase 4 — admin surface
  app.use('/api/v1/admin/settings', adminLimiter, settingsAdminRouter);
  app.use('/api/v1/admin/teams', adminLimiter, teamsAdminRouter);

  app.use('/api', (req, res) => {
    res
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Unknown endpoint.', requestId: req.requestId } });
  });

  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

  app.use(errorHandler);
  return app;
}

export { env, pool };
