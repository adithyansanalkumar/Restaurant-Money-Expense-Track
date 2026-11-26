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

function emailFromIdToken(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(idToken.split('.')[1])));
    return typeof payload.email === 'string' ? payload.email : null;
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

const kvKey = async (session: string) => 's:' + (await sha256Hex(session));

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
  if (path !== '/exchange' && path !== '/refresh' && path !== '/revoke') return jsonRes({ error: 'not_found' }, 404, origin);
  if (request.method !== 'POST') return jsonRes({ error: 'method_not_allowed' }, 405, origin);

  let body: any;
  try { body = await request.json(); } catch { return jsonRes({ error: 'bad_json' }, 400, origin); }
  if (!body || typeof body !== 'object') return jsonRes({ error: 'bad_json' }, 400, origin);

  if (path === '/exchange') {
    if (typeof body.code !== 'string' || !body.code) return jsonRes({ error: 'bad_request' }, 400, origin);
    assertKey(env.ENC_KEY); // fail before spending the one-time code
    const { ok, data } = await googleToken(env, { grant_type: 'authorization_code', code: body.code, redirect_uri: 'postmessage' });
    if (!ok) return jsonRes({ error: 'exchange_failed' }, 400, origin);
    if (!data.refresh_token) {
      // Google only returns a refresh token on consent. Revoking the grant makes it ask again,
      // so the app's immediate retry gets one.
      if (typeof data.access_token === 'string' && data.access_token) await revokeAtGoogle(data.access_token);
      return jsonRes({ error: 'consent_required' }, 409, origin);
    }
    const email = emailFromIdToken(data.id_token);
    if (!email) return jsonRes({ error: 'no_email' }, 400, origin);
    const session = randomSession();
    await env.TOKENS.put(await kvKey(session), await encrypt(data.refresh_token, env.ENC_KEY), kvOpts);
    return jsonRes({ session, accessToken: data.access_token, expiresIn: data.expires_in, email }, 200, origin);
  }

  // /refresh and /revoke
  if (typeof body.session !== 'string' || !body.session) return jsonRes({ error: 'unauthorized' }, 401, origin);
  const key = await kvKey(body.session);
  const stored = await env.TOKENS.get(key);
  if (!stored) {
    return path === '/revoke' ? respond(null, 204, origin) : jsonRes({ error: 'unauthorized' }, 401, origin);
  }
  let refreshToken: string;
  assertKey(env.ENC_KEY); // a misconfigured key is a server error, not a bad session
  try { refreshToken = await decrypt(stored, env.ENC_KEY); } catch {
    await env.TOKENS.delete(key);
    return path === '/revoke' ? respond(null, 204, origin) : jsonRes({ error: 'unauthorized' }, 401, origin);
  }

  if (path === '/revoke') {
    await revokeAtGoogle(refreshToken);
    await env.TOKENS.delete(key);
    return respond(null, 204, origin);
  }

  const { ok, data } = await googleToken(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (!ok) {
    if (data?.error === 'invalid_grant') {
      await env.TOKENS.delete(key);
      return jsonRes({ error: 'unauthorized' }, 401, origin);
    }
    return jsonRes({ error: 'refresh_failed' }, 502, origin);
  }
  await env.TOKENS.put(key, stored, kvOpts); // renew the 180-day expiry
  return jsonRes({ accessToken: data.access_token, expiresIn: data.expires_in }, 200, origin);
}
