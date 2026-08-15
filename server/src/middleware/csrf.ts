/**
 * CSRF protection — double-submit pattern via csrf-csrf v4 (§G).
 *
 * Flow:
 *   - GET  /api/v1/auth/csrf-token  → returns { csrfToken: "…" }
 *   - Every cookie-authenticated mutating request (POST/PATCH/PUT/DELETE) must
 *     include the token as request header:  x-csrf-token: <token>
 *
 * The Vue client calls GET /api/v1/auth/csrf-token once on app init (App.vue),
 * stores it in a module-level variable, and injects it into every mutating fetch
 * via the apiFetch wrapper in client/src/api/index.ts.
 *
 * Safe-methods (GET/HEAD/OPTIONS) are not checked.
 * The OAuth callback routes are excluded because they are server-side redirects
 * from external providers and cannot carry our header.
 */
import { doubleCsrf } from 'csrf-csrf';
import type { RequestHandler } from 'express';
import { env } from '../config/env.ts';

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => env.SESSION_SECRET,
  // Tie the token to the session so a token from one session can't be used in another.
  getSessionIdentifier: (req) => {
    const sess = req.session as { id?: string } | undefined;
    return sess?.id ?? '';
  },
  cookieName: 'bitlegion.csrf',
  cookieOptions: {
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    httpOnly: true,
    path: '/',
  },
  getCsrfTokenFromRequest: (req) =>
    (req.headers['x-csrf-token'] as string | undefined) ?? '',
  size: 64,
});

/** GET /api/v1/auth/csrf-token — issue a CSRF token for this session. */
export const csrfTokenHandler: RequestHandler = (req, res) => {
  const token = generateCsrfToken(req, res, { overwrite: true });
  res.json({ csrfToken: token });
};

/** Apply CSRF check to mutating routes. Excludes OAuth callbacks. */
export const csrfProtection: RequestHandler = (req, res, next) => {
  // Safe methods pass through without a token check.
  const safe = ['GET', 'HEAD', 'OPTIONS'];
  if (safe.includes(req.method)) return next();

  // OAuth server-side redirects cannot carry our header — exclude them.
  const path = (req.originalUrl ?? '').split('?')[0] ?? '';
  const excluded = [
    '/api/v1/auth/google/callback',
    '/api/v1/codeforces/link/callback',
  ];
  if (excluded.includes(path)) return next();

  return doubleCsrfProtection(req, res, next);
};
