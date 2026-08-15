import express from 'express';
import cookieParser from 'cookie-parser';
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
import { csrfProtection, csrfTokenHandler } from './middleware/csrf.ts';
import { errorHandler } from './middleware/errorHandler.ts';
import { authRouter } from './modules/auth/router.ts';
import { meRouter } from './modules/users/router.ts';
import { cfLinksRouter } from './modules/codeforces-links/router.ts';
import { leaderboardRouter } from './modules/leaderboards/router.ts';
import { settingsPublicRouter, settingsAdminRouter } from './modules/settings/router.ts';
import { teamsPublicRouter, teamsAdminRouter } from './modules/teams/router.ts';
import { profilesRouter } from './modules/profiles/router.ts';
import { adminRouter } from './modules/admin/router.ts';

const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');

// Process-local buckets (§F). Sufficient for a single Hostinger Node process.
const authLimiter  = rateLimit({ windowMs: 60_000, limit: 10,  standardHeaders: true });
const writeLimiter = rateLimit({ windowMs: 60_000, limit: 30,  standardHeaders: true });
const readLimiter  = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true });
const adminLimiter = rateLimit({ windowMs: 60_000, limit: 60,  standardHeaders: true });
// CF link attempts: 5/min/user (§F "link 5/min/user").
const linkLimiter  = rateLimit({ windowMs: 60_000, limit: 5,   standardHeaders: true });

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // Hostinger terminates TLS in front of Node

  // ── Security headers ────────────────────────────────────────────────────
  app.use(requestId);
  app.use(cookieParser());   // must be before session + CSRF
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:     ["'self'"],
          scriptSrc:      ["'self'"],          // no inline scripts; Vite produces hashed bundles
          styleSrc:       ["'self'", "'unsafe-inline'"],  // Vue scoped styles need this
          connectSrc:     ["'self'", 'https://codeforces.com'],
          imgSrc:         ["'self'", 'https:', 'data:'],
          fontSrc:        ["'self'"],
          frameSrc:       ["'none'"],
          objectSrc:      ["'none'"],
          upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
        },
      },
      // HSTS: 1 year, include subdomains (production only — Hostinger HTTPS)
      strictTransportSecurity: env.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginEmbedderPolicy: false, // CF API calls would fail otherwise
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware());

  // ── CSRF protection (§G) — applied after session so req.session is available ──
  app.use(csrfProtection);

  // ── Health ──────────────────────────────────────────────────────────────
  app.get('/api/v1/health', async (_req, res) => {
    const database = (await dbReachable()) ? 'ok' : 'down';
    let activeLeaderboardGeneratedAt: string | null = null;
    if (database === 'ok') {
      try {
        const ts = await getActiveVersionCompletedAt();
        activeLeaderboardGeneratedAt = ts ? ts.toISOString() : null;
      } catch {
        // Non-fatal: leaderboard tables may not exist yet.
      }
    }
    res.json({
      status: database === 'ok' ? 'ok' : 'degraded',
      database,
      activeLeaderboardGeneratedAt,
      version: process.env.GIT_SHA ?? 'dev',
    });
  });

  // CSRF token endpoint — GET only (safe method), no CSRF check needed
  app.get('/api/v1/auth/csrf-token', csrfTokenHandler);

  // ── API routes ──────────────────────────────────────────────────────────
  app.use('/api/v1/auth',             authLimiter,  authRouter);
  app.use('/api/v1/me',               writeLimiter, meRouter);
  app.use('/api/v1/codeforces',       linkLimiter,  cfLinksRouter);

  // Public read surface
  app.use('/api/v1/leaderboards',     readLimiter,  leaderboardRouter);
  app.use('/api/v1/settings/public',  readLimiter,  settingsPublicRouter);
  app.use('/api/v1/teams',            readLimiter,  teamsPublicRouter);
  app.use('/api/v1/profiles',         readLimiter,  profilesRouter);

  // Admin surface
  app.use('/api/v1/admin/settings',   adminLimiter, settingsAdminRouter);
  app.use('/api/v1/admin/teams',      adminLimiter, teamsAdminRouter);
  app.use('/api/v1/admin',            adminLimiter, adminRouter);

  // 404 for unknown /api routes
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Unknown endpoint.', requestId: req.requestId },
    });
  });

  // ── Static assets + SPA fallback ────────────────────────────────────────
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));

  app.use(errorHandler);
  return app;
}

export { env, pool };
