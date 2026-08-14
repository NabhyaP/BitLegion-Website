/**
 * CF OIDC linking routes (§B2).
 *
 * GET  /api/v1/codeforces/link/start     — requireAuth + requireRecentAuth → CF authorize
 * GET  /api/v1/codeforces/link/callback  — CF redirects back here; no auth middleware
 *                                          (the session is used to verify the attempt)
 * DELETE /api/v1/codeforces/link         — requireAuth + requireRecentAuth → unlink
 *
 * Template: server/src/modules/auth/router.ts (Google OIDC).
 */
import { Router } from 'express';
import * as client from 'openid-client';
import { env } from '../../config/env.ts';
import { requireAuth, requireRecentAuth } from '../../middleware/auth.ts';
import { badRequest } from '../../shared/errors.ts';
import * as repo from './repository.ts';
import { linkCfHandle, unlinkCfHandle } from './service.ts';

// ---------------------------------------------------------------------------
// CF OIDC discovery (cached for the process lifetime, like the Google config).
// ---------------------------------------------------------------------------

/**
 * Per §B2, the CF discovery document lives at:
 * https://codeforces.com/.well-known/openid-configuration
 *
 * 🔑 Blocked on owner creating the CF OAuth app at codeforces.com/settings/api and
 *    setting CF_OIDC_CLIENT_ID / CF_OIDC_CLIENT_SECRET. The routes work end-to-end
 *    once those env vars are present; the tests use fixture-based validation and
 *    never hit the real CF endpoint.
 */
const CF_ISSUER = 'https://codeforces.com';
const CALLBACK_PATH = '/api/v1/codeforces/link/callback';

let cfConfigCache: Promise<client.Configuration> | null = null;

function cfConfig(): Promise<client.Configuration> {
  if (!env.CF_OIDC_CLIENT_ID || !env.CF_OIDC_CLIENT_SECRET) {
    return Promise.reject(new Error('Codeforces OIDC is not configured (CF_OIDC_CLIENT_ID / CF_OIDC_CLIENT_SECRET missing).'));
  }
  cfConfigCache ??= client.discovery(
    new URL(CF_ISSUER),
    env.CF_OIDC_CLIENT_ID,
    env.CF_OIDC_CLIENT_SECRET,
  );
  return cfConfigCache;
}

const callbackUri = () => new URL(CALLBACK_PATH, env.APP_URL).toString();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const cfLinksRouter = Router();

// ── START ──────────────────────────────────────────────────────────────────
cfLinksRouter.get('/link/start', requireAuth, requireRecentAuth, async (req, res, next) => {
  try {
    const config = await cfConfig();
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();

    // Persist the PKCE + state + nonce in the DB so it survives a server restart.
    // The session also carries it as a fast lookup key for the callback.
    await repo.createLinkAttempt(req.user!.id, state, nonce, verifier);

    // Store in session for the callback to pick up (single process; consistent).
    req.session.cfOauth = { state, nonce, verifier };

    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: callbackUri(),
      scope: 'openid',
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });

    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

// ── CALLBACK ───────────────────────────────────────────────────────────────
cfLinksRouter.get('/link/callback', async (req, res) => {
  // §B2: redirect errors to /onboarding?error=<code>.
  const fail = (reason: string) => res.redirect(`/onboarding?error=${encodeURIComponent(reason)}`);

  // 1. Consume the session state (single-use).
  const pending = req.session.cfOauth;
  delete req.session.cfOauth;

  if (!pending) return fail('cf-link-expired');

  // 2. The session must still have a logged-in user.
  const userId = req.session?.userId;
  if (!userId) return fail('cf-link-session-lost');

  // 3. Also consume the DB-side attempt (validates expiry + single-use).
  const attempt = await repo.consumeLinkAttempt(pending.state).catch(() => null);
  if (!attempt) return fail('cf-link-expired');

  // Sanity: the session user must match the attempt owner.
  if (attempt.userId !== userId) return fail('cf-link-mismatch');

  try {
    const config = await cfConfig();

    // 4. Exchange the code; openid-client validates issuer/audience/signature/
    //    state/nonce/PKCE/expiry in one call.
    const tokens = await client.authorizationCodeGrant(
      config,
      new URL(req.originalUrl, env.APP_URL),
      {
        pkceCodeVerifier: attempt.pkceVerifier,
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        idTokenExpected: true,
      },
    );

    const claims = tokens.claims();
    if (!claims) return fail('cf-link-invalid-token');

    // 5. Extract the CF handle.
    //    CF OIDC uses the handle as the `sub` claim (it is the account's
    //    primary identifier on Codeforces). Prefer a dedicated `handle` claim
    //    if CF ever adds one; fall back to `sub`.
    const rawHandle = (claims['handle'] as string | undefined) ?? String(claims.sub);
    if (!rawHandle) return fail('cf-link-invalid-token');

    // 6. Link (or re-link) in a transaction; audit inside.
    await linkCfHandle(userId, rawHandle, req.requestId ?? null);

    // §B2: redirect to dashboard with a success hint so the client starts
    // its IndexedDB fetch cycle.
    res.redirect('/dashboard?linked=1');
  } catch (err: unknown) {
    // handle-taken → tell the user.
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'HANDLE_TAKEN') {
      return fail('cf-handle-taken');
    }
    // Any other error (CF unreachable, token validation failed, etc.)
    return fail('cf-link-failure');
  }
});

// ── UNLINK ─────────────────────────────────────────────────────────────────
cfLinksRouter.delete('/link', requireAuth, requireRecentAuth, async (req, res, next) => {
  try {
    await unlinkCfHandle(req.user!.id, req.requestId ?? null);
    // §B2: client should clear IndexedDB for the old handle after receiving 204.
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
