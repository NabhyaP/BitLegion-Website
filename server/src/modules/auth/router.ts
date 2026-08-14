import { Router } from 'express';
import * as client from 'openid-client';
import { env } from '../../config/env.ts';
import { destroySession, regenerate } from '../../middleware/session.ts';
import { SignInError, signInWithGoogleClaims } from './service.ts';

const GOOGLE_ISSUER = 'https://accounts.google.com';
const CALLBACK_PATH = '/api/v1/auth/google/callback';

let configCache: Promise<client.Configuration> | null = null;
function googleConfig(): Promise<client.Configuration> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Promise.reject(new Error('Google OAuth is not configured'));
  }
  // Discovery is cached for the process — it is a static document.
  configCache ??= client.discovery(
    new URL(GOOGLE_ISSUER),
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
  );
  return configCache;
}

const redirectUri = () => new URL(CALLBACK_PATH, env.APP_URL).toString();

export const authRouter = Router();

authRouter.get('/google/start', async (req, res, next) => {
  try {
    const config = await googleConfig();
    const verifier = client.randomPKCECodeVerifier();
    const state = client.randomState();
    const nonce = client.randomNonce();
    req.session.oauth = {
      state,
      nonce,
      verifier,
      returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined,
    };
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri(),
      scope: 'openid email profile',
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      // Login hint only — the suffix check in the service is the real enforcement.
      hd: env.ALLOWED_EMAIL_SUFFIX,
    });
    res.redirect(url.toString());
  } catch (err) {
    next(err);
  }
});

authRouter.get('/google/callback', async (req, res) => {
  const fail = (reason: string) => res.redirect(`/login?error=${reason}`);
  const pending = req.session.oauth;
  delete req.session.oauth; // single-use, whatever happens next
  if (!pending) return fail('oauth-failure');

  try {
    const config = await googleConfig();
    // 1. Validates state, nonce, PKCE, issuer, audience, signature and expiry.
    const tokens = await client.authorizationCodeGrant(
      config,
      new URL(req.originalUrl, env.APP_URL),
      {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      },
    );
    const claims = tokens.claims();
    if (!claims) return fail('oauth-failure');

    const { user, isNew } = await signInWithGoogleClaims(
      {
        sub: String(claims.sub),
        email: claims.email as string | undefined,
        email_verified: claims.email_verified as boolean | undefined,
        name: claims.name as string | undefined,
        picture: claims.picture as string | undefined,
      },
      req.requestId ?? null,
    );

    // 8. Rotate the session ID on sign-in, then store identity.
    await regenerate(req);
    req.session.userId = user.id;
    req.session.authAt = Date.now();

    const returnTo = pending.returnTo?.startsWith('/') ? pending.returnTo : null;
    // 9. New or unconfirmed users go to onboarding; Phase 2 adds the CF-link check.
    res.redirect(returnTo ?? (isNew || !user.profileConfirmed ? '/onboarding' : '/dashboard'));
  } catch (err) {
    if (err instanceof SignInError) return fail(err.reason);
    return fail('oauth-failure');
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie('bitlegion.sid', { path: '/' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
