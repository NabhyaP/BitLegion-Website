import '../config/env.ts';
import { env } from '../config/env.ts';
import { discovery } from 'openid-client';
const cfg = await discovery(
  new URL('https://codeforces.com'),
  env.CF_OIDC_CLIENT_ID ?? '',
  env.CF_OIDC_CLIENT_SECRET ?? '',
).catch((e: unknown) => { console.error('FAIL:', (e as Error).message); process.exit(1); });
console.log('OK. Issuer:', cfg.serverMetadata().issuer);
console.log('token_endpoint_auth_methods:', cfg.serverMetadata().token_endpoint_auth_methods_supported);
console.log('id_token_algs:', cfg.serverMetadata().id_token_signing_alg_values_supported);
