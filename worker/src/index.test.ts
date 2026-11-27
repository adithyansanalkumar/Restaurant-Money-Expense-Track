import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { type Env } from './index';

class MemKV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  puts: { k: string; opts?: { expirationTtl?: number } }[] = [];
  async put(k: string, v: string, opts?: { expirationTtl?: number }) { this.m.set(k, v); this.puts.push({ k, opts }); }
  async delete(k: string) { this.m.delete(k); }
}

const ORIGIN = 'http://localhost:5173';
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const idToken = (p: object) => `h.${b64url(JSON.stringify(p))}.s`;

let kv: MemKV;
let env: Env;
let fetchMock: ReturnType<typeof vi.fn>;

function req(path: string, body: unknown, origin: string | null = ORIGIN, method = 'POST') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin) headers.Origin = origin;
  return new Request('https://w.example' + path, {
    method,
    headers,
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const call = (r: Request) => worker.fetch(r, env);

beforeEach(() => {
  kv = new MemKV();
  env = {
    TOKENS: kv as unknown as Env['TOKENS'],
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csecret',
    ENC_KEY: btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i + 1))),
    ALLOWED_ORIGINS: 'http://localhost:5173, https://app.pages.dev',
  };
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function doExchange(o: { rt?: string | null; sub?: string; email?: string; at?: string } = {}) {
  const tok: Record<string, unknown> = {
    access_token: o.at ?? 'AT1', expires_in: 3599,
    id_token: idToken({ sub: o.sub ?? 'sub-1', email: o.email ?? 'a@b.com' }),
  };
  if (o.rt !== null) tok.refresh_token = o.rt ?? 'RT-SECRET-123';
  fetchMock.mockResolvedValueOnce(json(tok));
  return call(req('/exchange', { code: 'CODE' }));
}
const sessionOf = async (r: Response) => ((await r.json()) as any).session as string;
const keys = (prefix: string) => [...kv.m.keys()].filter((k) => k.startsWith(prefix));

describe('origin / CORS', () => {
  it('rejects a wrong Origin with 403 and no CORS headers', async () => {
    const res = await call(req('/refresh', { session: 'x' }, 'https://evil.example'));
    expect(res.status).toBe(403);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('rejects a missing Origin with 403', async () => {
    expect((await call(req('/refresh', { session: 'x' }, null))).status).toBe(403);
  });
  it('answers preflight for allowed origins', async () => {
    const res = await call(new Request('https://w.example/exchange', { method: 'OPTIONS', headers: { Origin: 'https://app.pages.dev' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.pages.dev');
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
    expect(res.headers.get('Vary')).toBe('Origin');
  });
  it('adds Allow-Origin to normal responses', async () => {
    const res = await call(req('/refresh', { session: 'nope' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
});

describe('routing', () => {
  it('405 on wrong method, 404 unknown path, 400 bad JSON', async () => {
    expect((await call(req('/exchange', null, ORIGIN, 'GET'))).status).toBe(405);
    expect((await call(req('/nope', {}))).status).toBe(404);
    expect((await call(req('/exchange', '{bad'))).status).toBe(400);
  });
});

describe('/exchange', () => {
  it('stores the refresh token per account (a:<sha256 sub>) and the session (s:<sha256 session>), both encrypted', async () => {
    const res = await doExchange();
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.email).toBe('a@b.com');
    expect(body.accessToken).toBe('AT1');
    expect(body.expiresIn).toBe(3599);
    expect(body.session).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const p = new URLSearchParams(init.body as string);
    expect(p.get('grant_type')).toBe('authorization_code');
    expect(p.get('code')).toBe('CODE');
    expect(p.get('client_id')).toBe('cid');
    expect(p.get('client_secret')).toBe('csecret');
    expect(p.get('redirect_uri')).toBe('postmessage');

    expect(kv.m.size).toBe(2);
    expect(keys('a:')).toHaveLength(1);
    expect(keys('a:')[0]).toMatch(/^a:[0-9a-f]{64}$/);
    expect(keys('a:')[0]).not.toContain('sub-1');
    expect(keys('s:')[0]).toMatch(/^s:[0-9a-f]{64}$/);
    expect(keys('s:')[0]).not.toContain(body.session);
    for (const v of kv.m.values()) {
      expect(v).not.toContain('RT-SECRET-123');
      expect(atob(v.replace(/-/g, '+').replace(/_/g, '/')).includes('RT-SECRET-123')).toBe(false);
      expect(atob(v.replace(/-/g, '+').replace(/_/g, '/')).includes('sub-1')).toBe(false);
    }
  });
  it('a second phone of the same account without a refresh token reuses the stored one (no revoke)', async () => {
    await doExchange();
    const res = await doExchange({ rt: null, at: 'AT-PHONE2' });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2); // no revoke call
    expect(keys('a:')).toHaveLength(1);
    expect(keys('s:')).toHaveLength(2);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT3', expires_in: 3000 }));
    expect((await call(req('/refresh', { session: await sessionOf(res) }))).status).toBe(200);
    expect(new URLSearchParams(fetchMock.mock.calls[2][1].body as string).get('refresh_token')).toBe('RT-SECRET-123');
  });
  it('a new refresh token replaces the account one', async () => {
    await doExchange();
    const r2 = await doExchange({ rt: 'RT-NEW' });
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT3', expires_in: 3000 }));
    await call(req('/refresh', { session: await sessionOf(r2) }));
    expect(new URLSearchParams(fetchMock.mock.calls[2][1].body as string).get('refresh_token')).toBe('RT-NEW');
  });
  it('first time with no refresh token and none stored: revokes the access token (form body), 409 consent_required', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'AT-NORT', expires_in: 10, id_token: idToken({ sub: 'sub-1', email: 'a@b.com' }) }))
      .mockResolvedValueOnce(new Response('', { status: 200 }));
    const res = await call(req('/exchange', { code: 'C' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'consent_required' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(kv.m.size).toBe(0);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(init.body as string).get('token')).toBe('AT-NORT');
  });
  it('still 409 when revoking the access token fails', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ access_token: 'AT', expires_in: 10, id_token: idToken({ sub: 'sub-1', email: 'a@b.com' }) }))
      .mockRejectedValueOnce(new Error('net'));
    expect((await call(req('/exchange', { code: 'C' }))).status).toBe(409);
  });
  it('an id_token without sub is refused', async () => {
    fetchMock.mockResolvedValueOnce(json({ refresh_token: 'R', access_token: 'A', expires_in: 1, id_token: idToken({ email: 'a@b.com' }) }));
    expect((await call(req('/exchange', { code: 'C' }))).status).toBe(400);
    expect(kv.m.size).toBe(0);
  });
  it('stores both keys with a 180-day TTL', async () => {
    await doExchange();
    expect(kv.puts.map((p) => p.opts)).toEqual([{ expirationTtl: 15552000 }, { expirationTtl: 15552000 }]);
  });
});

describe('/refresh', () => {
  it('401 for an unknown session', async () => {
    const res = await call(req('/refresh', { session: 'unknown' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('resolves session -> account -> refresh token and refreshes', async () => {
    const session = await sessionOf(await doExchange());
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT2', expires_in: 3000 }));
    const res = await call(req('/refresh', { session }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: 'AT2', expiresIn: 3000 });
    const p = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(p.get('grant_type')).toBe('refresh_token');
    expect(p.get('refresh_token')).toBe('RT-SECRET-123');
  });
  it('renews both 180-day TTLs on each successful refresh', async () => {
    const session = await sessionOf(await doExchange());
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT2', expires_in: 3000 }));
    await call(req('/refresh', { session }));
    expect(kv.puts).toHaveLength(4);
    expect(new Set(kv.puts.slice(2).map((p) => p.k))).toEqual(new Set(kv.puts.slice(0, 2).map((p) => p.k)));
    expect(kv.puts.slice(2).every((p) => p.opts?.expirationTtl === 15552000)).toBe(true);
  });
  it('does not renew the TTL when the refresh fails', async () => {
    const session = await sessionOf(await doExchange());
    fetchMock.mockResolvedValueOnce(json({ error: 'server' }, 500));
    expect((await call(req('/refresh', { session }))).status).toBe(502);
    expect(kv.puts).toHaveLength(2);
  });
  it('invalid_grant deletes the account key (and this session) and returns 401; other phones then get 401 too', async () => {
    const s1 = await sessionOf(await doExchange());
    const s2 = await sessionOf(await doExchange({ rt: null }));
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    expect((await call(req('/refresh', { session: s1 }))).status).toBe(401);
    expect(keys('a:')).toHaveLength(0);
    expect(keys('s:')).toHaveLength(1);
    const n = fetchMock.mock.calls.length;
    expect((await call(req('/refresh', { session: s2 }))).status).toBe(401);
    expect(fetchMock.mock.calls.length).toBe(n); // no Google call without a refresh token
    expect(kv.m.size).toBe(0);
  });
});

describe('/revoke (sign out one phone)', () => {
  it('deletes only that session; the account grant stays and the other phone keeps working', async () => {
    const s1 = await sessionOf(await doExchange());
    const s2 = await sessionOf(await doExchange({ rt: null }));
    const res = await call(req('/revoke', { session: s1 }));
    expect(res.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2); // never revokes at Google
    expect(keys('a:')).toHaveLength(1);
    expect(keys('s:')).toHaveLength(1);
    expect((await call(req('/refresh', { session: s1 }))).status).toBe(401);
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT2', expires_in: 3000 }));
    expect((await call(req('/refresh', { session: s2 }))).status).toBe(200);
  });
  it('204 for an unknown session', async () => {
    expect((await call(req('/revoke', { session: 'nope' }))).status).toBe(204);
  });
});

describe('/disconnect', () => {
  it('revokes the grant at Google (token in the form body) and deletes the account key and this session', async () => {
    const s1 = await sessionOf(await doExchange());
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    const res = await call(req('/disconnect', { session: s1 }));
    expect(res.status).toBe(204);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(url).not.toContain('RT-SECRET-123');
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(new URLSearchParams(init.body as string).get('token')).toBe('RT-SECRET-123');
    expect(kv.m.size).toBe(0);
  });
  it('204 even if Google errors', async () => {
    const s1 = await sessionOf(await doExchange());
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    expect((await call(req('/disconnect', { session: s1 }))).status).toBe(204);
    expect(kv.m.size).toBe(0);
  });
  it('204 for an unknown session, no Google call', async () => {
    expect((await call(req('/disconnect', { session: 'nope' }))).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('hardening', () => {
  it('an unexpected error returns 500 server_error with CORS headers', async () => {
    kv.get = async () => { throw new Error('kv down'); };
    const res = await call(req('/refresh', { session: 'x' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(res.headers.get('content-type')).toBe('application/json');
  });
  it('a network error talking to Google returns 500 server_error with CORS', async () => {
    fetchMock.mockRejectedValueOnce(new Error('net'));
    const res = await call(req('/exchange', { code: 'C' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });
  it('an ENC_KEY that is not 32 bytes gives 500 server_error and stores nothing', async () => {
    env.ENC_KEY = btoa('short-key-16byte');
    const res = await call(req('/exchange', { code: 'CODE' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'server_error' });
    expect(fetchMock).not.toHaveBeenCalled(); // the one-time code is not spent
    expect(kv.m.size).toBe(0);
  });
  it('a bad ENC_KEY on /refresh is a 500 and keeps the stored session', async () => {
    const { session } = await (await doExchange()).json() as any;
    env.ENC_KEY = btoa('x'.repeat(31));
    const res = await call(req('/refresh', { session }));
    expect(res.status).toBe(500);
    expect(kv.m.size).toBe(2);
  });
  it('accepts a standard base64 32-byte key (openssl rand -base64 32)', async () => {
    env.ENC_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(0xfb)));
    expect(env.ENC_KEY).toMatch(/[+/]/);
    expect((await doExchange()).status).toBe(200);
  });
});
