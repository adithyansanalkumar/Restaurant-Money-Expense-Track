import { assertKey, b64urlDecode, decrypt, encrypt, randomSession, sha256Hex } from './crypto';

export interface Env {
  TOKENS: { get(k: string): Promise<string | null>; put(k: string, v: string, opts?: { expirationTtl?: number }): Promise<void>; delete(k: string): Promise<void> };
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** base64, 32 bytes */
  ENC_KEY: string;
  /** comma-separated */
  ALLOWED_ORIGINS: string;
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
/** Stored sessions expire after 180 days without a successful refresh. */
export const SESSION_TTL_S = 15552000;
const kvOpts = { expirationTtl: SESSION_TTL_S };

function respond(body: BodyInit | null, status: number, origin: string | null, extra: Record<string, string> = {}): Response {
  const headers = new Headers(extra);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return new Response(body, { status, headers });
}

function jsonRes(obj: unknown, status: number, origin: string | null): Response {
  return respond(JSON.stringify(obj), status, origin, { 'content-type': 'application/json' });
}

/** sub + email from the id_token Google returned with the code exchange (TLS from Google; not re-verified). */
function claimsFromIdToken(idToken: unknown): { sub: string; email: string } | null {
  if (typeof idToken !== 'string') return null;
  try {
    const p = JSON.parse(new TextDecoder().decode(b64urlDecode(idToken.split('.')[1])));
    return typeof p.sub === 'string' && p.sub && typeof p.email === 'string' && p.email ? { sub: p.sub, email: p.email } : null;
  } catch {
    return null;
  }
}

async function googleToken(env: Env, params: Record<string, string>): Promise<{ ok: boolean; data: any }> {
  const body = new URLSearchParams({ ...params, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  let data: any = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  return { ok: res.ok, data };
}

/** Revokes a token at Google; the token goes in the form body, never in the URL. Best effort. */
async function revokeAtGoogle(token: string): Promise<void> {
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch { /* best effort */ }
}

/**
 * KV layout (both AES-GCM encrypted, both 180-day TTL renewed on each successful /refresh):
 *   a:<sha256(sub)>     = the Google refresh token of that account (one per account, shared by its phones)
 *   s:<sha256(session)> = JSON {sub} (one per signed-in phone)
 * Signing out one phone deletes only its session; /disconnect revokes the account's grant.
 */
const sessionKey = async (session: string) => 's:' + (await sha256Hex(session));
const accountKey = async (sub: string) => 'a:' + (await sha256Hex(sub));

async function putEnc(env: Env, key: string, plain: string): Promise<void> {
  await env.TOKENS.put(key, await encrypt(plain, env.ENC_KEY), kvOpts);
}
async function getDec(env: Env, key: string): Promise<string | null> {
  const stored = await env.TOKENS.get(key);
  if (!stored) return null;
  try { return await decrypt(stored, env.ENC_KEY); } catch { await env.TOKENS.delete(key); return null; }
}

/** session -> { sub, sKey } or null (unknown / unreadable session). */
async function readSession(env: Env, session: unknown): Promise<{ sub: string; sKey: string } | null> {
  if (typeof session !== 'string' || !session) return null;
  const sKey = await sessionKey(session);
  const plain = await getDec(env, sKey);
  if (!plain) return null;
  try {
    const { sub } = JSON.parse(plain);
    if (typeof sub === 'string' && sub) return { sub, sKey };
  } catch { /* fall through */ }
  await env.TOKENS.delete(sKey);
  return null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!origin || !allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    try {
      return await handle(request, env, origin);
    } catch {
      // never leak details; keep CORS so the app can read the error
      return jsonRes({ error: 'server_error' }, 500, origin);
    }
  },
};

async function handle(request: Request, env: Env, origin: string): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return respond(null, 204, origin, {
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    });
  }

  const path = new URL(request.url).pathname;
  if (!['/exchange', '/refresh', '/revoke', '/disconnect'].includes(path)) return jsonRes({ error: 'not_found' }, 404, origin);
  if (request.method !== 'POST') return jsonRes({ error: 'method_not_allowed' }, 405, origin);

  let body: any;
  try { body = await request.json(); } catch { return jsonRes({ error: 'bad_json' }, 400, origin); }
  if (!body || typeof body !== 'object') return jsonRes({ error: 'bad_json' }, 400, origin);
  assertKey(env.ENC_KEY); // a misconfigured key is a server error (before spending a one-time code)

  if (path === '/exchange') {
    if (typeof body.code !== 'string' || !body.code) return jsonRes({ error: 'bad_request' }, 400, origin);
    const { ok, data } = await googleToken(env, { grant_type: 'authorization_code', code: body.code, redirect_uri: 'postmessage' });
    if (!ok) return jsonRes({ error: 'exchange_failed' }, 400, origin);
    const claims = claimsFromIdToken(data.id_token);
    if (!claims) return jsonRes({ error: 'no_email' }, 400, origin);
    const aKey = await accountKey(claims.sub);
    if (data.refresh_token) {
      await putEnc(env, aKey, data.refresh_token);
    } else {
      // Google sends a refresh token only on first consent. Another phone of this account stored it.
      const existing = await getDec(env, aKey);
      if (!existing) {
        // first-time edge: nothing stored. Revoking makes Google ask for consent on the next tap.
        if (typeof data.access_token === 'string' && data.access_token) await revokeAtGoogle(data.access_token);
        return jsonRes({ error: 'consent_required' }, 409, origin);
      }
      await putEnc(env, aKey, existing); // renew
    }
    const session = randomSession();
    await putEnc(env, await sessionKey(session), JSON.stringify({ sub: claims.sub }));
    return jsonRes({ session, accessToken: data.access_token, expiresIn: data.expires_in, email: claims.email }, 200, origin);
  }

  const s = await readSession(env, body.session);

  if (path === '/revoke') {
    // sign-out of this phone only: the account's grant (used by its other phones) stays
    if (s) await env.TOKENS.delete(s.sKey);
    return respond(null, 204, origin);
  }

  if (path === '/disconnect') {
    if (s) {
      const aKey = await accountKey(s.sub);
      const rt = await getDec(env, aKey);
      if (rt) await revokeAtGoogle(rt);
      await env.TOKENS.delete(aKey);
      await env.TOKENS.delete(s.sKey);
    }
    return respond(null, 204, origin);
  }

  // /refresh
  if (!s) return jsonRes({ error: 'unauthorized' }, 401, origin);
  const aKey = await accountKey(s.sub);
  const refreshToken = await getDec(env, aKey);
  if (!refreshToken) {
    await env.TOKENS.delete(s.sKey);
    return jsonRes({ error: 'unauthorized' }, 401, origin);
  }
  const { ok, data } = await googleToken(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!ok) {
    if (data?.error === 'invalid_grant') {
      // the grant is gone (revoked or expired): every phone of this account must sign in again
      await env.TOKENS.delete(aKey);
      await env.TOKENS.delete(s.sKey);
      return jsonRes({ error: 'unauthorized' }, 401, origin);
    }
    return jsonRes({ error: 'refresh_failed' }, 502, origin);
  }
  // renew both 180-day expiries (and keep a rotated refresh token if Google sent one)
  await putEnc(env, aKey, typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : refreshToken);
  await putEnc(env, s.sKey, JSON.stringify({ sub: s.sub }));
  return jsonRes({ accessToken: data.access_token, expiresIn: data.expires_in }, 200, origin);
}
