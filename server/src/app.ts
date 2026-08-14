import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.ts';
import { dbReachable, pool } from './db/pool.ts';
import { requestId } from './middleware/requestId.ts';
import { sessionMiddleware } from './middleware/session.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { authRouter } from './modules/auth/router.ts';
import { meRouter } from './modules/users/router.ts';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Process-local buckets (§F). Sufficient for a single Hostinger Node process.
const authLimiter = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true });

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
    // ponytail: snapshot age reported once leaderboard tables exist (Phase 3).
    res.json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      activeLeaderboardGeneratedAt: null,
      version: process.env.GIT_SHA ?? 'dev',
    });
  });

  app.use('/api/v1/auth', authLimiter, authRouter);
  app.use('/api/v1/me', writeLimiter, meRouter);

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
