import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import { env } from '../config/env.ts';
import { pool } from '../db/pool.ts';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    /** Epoch ms of the last full authentication — drives the <30 min recent-auth gate (§B1). */
    authAt?: number;
    /** Transient OIDC handshake state, cleared on completion. */
    oauth?: { state: string; nonce: string; verifier: string; returnTo?: string };
  }
}

const MySQLStore = MySQLStoreFactory(session as never);

export function sessionMiddleware() {
  // express-mysql-session creates and reaps its own `sessions` table (§D note).
  const store = new MySQLStore({ createDatabaseTable: true }, pool as never);
  return session({
    name: 'bitlegion.sid',
    secret: env.SESSION_SECRET,
    store: store as never,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}

/** Rotate the session ID while preserving data — used on sign-in and privilege change (§B1). */
export function regenerate(req: {
  session: { regenerate: (cb: (err?: unknown) => void) => void };
}): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => (err ? reject(err) : resolve())),
  );
}

export function destroySession(req: {
  session: { destroy: (cb: (err?: unknown) => void) => void };
}): Promise<void> {
  return new Promise((resolve, reject) =>
    req.session.destroy((err) => (err ? reject(err) : resolve())),
  );
}
