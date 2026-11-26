import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import worker, { type Env } from './index';

class MemKV {
  m = new Map<string, string>();
  async get(k: string) { return this.m.get(k) ?? null; }
  async put(k: string, v: string) { this.m.set(k, v); }
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

async function doExchange() {
  fetchMock.mockResolvedValueOnce(json({
    refresh_token: 'RT-SECRET-123', access_token: 'AT1', expires_in: 3599,
    id_token: idToken({ email: 'a@b.com' }),
  }));
  return call(req('/exchange', { code: 'CODE' }));
}

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
  it('stores an encrypted refresh token under a hashed key and returns the session', async () => {
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

    expect(kv.m.size).toBe(1);
    const [key, value] = [...kv.m.entries()][0];
    expect(key).toMatch(/^s:[0-9a-f]{64}$/);
    expect(key).not.toContain(body.session);
    expect(value).not.toContain('RT-SECRET-123');
    expect(atob(value.replace(/-/g, '+').replace(/_/g, '/')).includes('RT-SECRET-123')).toBe(false);
  });
  it('400 no_refresh_token when Google returns none', async () => {
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT', expires_in: 10, id_token: idToken({ email: 'a@b.com' }) }));
    const res = await call(req('/exchange', { code: 'C' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'no_refresh_token' });
    expect(kv.m.size).toBe(0);
  });
});

describe('/refresh', () => {
  it('401 for an unknown session', async () => {
    const res = await call(req('/refresh', { session: 'unknown' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('decrypts and refreshes', async () => {
    const { session } = await (await doExchange()).json() as any;
    fetchMock.mockResolvedValueOnce(json({ access_token: 'AT2', expires_in: 3000 }));
    const res = await call(req('/refresh', { session }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ accessToken: 'AT2', expiresIn: 3000 });
    const p = new URLSearchParams(fetchMock.mock.calls[1][1].body as string);
    expect(p.get('grant_type')).toBe('refresh_token');
    expect(p.get('refresh_token')).toBe('RT-SECRET-123');
  });
  it('invalid_grant deletes the key and returns 401', async () => {
    const { session } = await (await doExchange()).json() as any;
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_grant' }, 400));
    const res = await call(req('/refresh', { session }));
    expect(res.status).toBe(401);
    expect(kv.m.size).toBe(0);
  });
});

describe('/revoke', () => {
  it('revokes at Google, deletes the key, returns 204', async () => {
    const { session } = await (await doExchange()).json() as any;
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    const res = await call(req('/revoke', { session }));
    expect(res.status).toBe(204);
    expect(kv.m.size).toBe(0);
    expect(fetchMock.mock.calls[1][0]).toBe('https://oauth2.googleapis.com/revoke?token=RT-SECRET-123');
  });
  it('204 even if Google errors', async () => {
    const { session } = await (await doExchange()).json() as any;
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const res = await call(req('/revoke', { session }));
    expect(res.status).toBe(204);
    expect(kv.m.size).toBe(0);
  });
});
