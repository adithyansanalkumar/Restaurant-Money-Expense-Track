import { db } from '../db/db';

export class AuthNeeded extends Error {
  constructor(message = 'Sign-in required') { super(message); this.name = 'AuthNeeded'; }
}
export class Offline extends Error {
  constructor(message = 'Network unavailable') { super(message); this.name = 'Offline'; }
}

const GIS_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const EXPIRY_MARGIN_MS = 60_000;

interface StoredAuth { session: string; email: string }
let cached: { token: string; expiresAt: number } | null = null;
// Bumped on signIn/signOut so a refresh that was in flight across them is dropped.
let epoch = 0;
let refreshing: Promise<string> | null = null;
let gisLoading: Promise<void> | null = null;

const authUrl = () => (import.meta.env.VITE_AUTH_URL as string | undefined) ?? '';

async function readAuth(): Promise<StoredAuth | null> {
  return ((await db.meta.get('auth'))?.value as StoredAuth | undefined) ?? null;
}

export async function currentEmail(): Promise<string | null> {
  return (await readAuth())?.email ?? null;
}

function loadGis(): Promise<void> {
  const w = window as any;
  if (w.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; s.remove(); reject(new Offline('Could not load Google sign-in')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

async function post(path: string, body: unknown): Promise<Response> {
  try {
    return await fetch(`${authUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Offline();
  }
}

export async function signIn(): Promise<{ email: string }> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId || !authUrl()) {
    throw new Error('Sign-in is not configured: set VITE_GOOGLE_CLIENT_ID and VITE_AUTH_URL');
  }
  await loadGis();
  const code = await new Promise<string>((resolve, reject) => {
    const client = (window as any).google.accounts.oauth2.initCodeClient({
      client_id: clientId,
      scope: SCOPE,
      ux_mode: 'popup',
      callback: (r: { code?: string; error?: string }) =>
        r.code ? resolve(r.code) : reject(new Error(r.error || 'Sign-in cancelled')),
      error_callback: (e: { type?: string }) => reject(new Error(e?.type || 'Sign-in cancelled')),
    });
    client.requestCode();
  });
  const res = await post('/exchange', { code });
  if (!res.ok) throw new Error('Sign-in failed');
  const d = await res.json() as { session: string; accessToken: string; expiresIn: number; email: string };
  epoch++;
  refreshing = null;
  await db.meta.put({ key: 'auth', value: { session: d.session, email: d.email } satisfies StoredAuth });
  cached = { token: d.accessToken, expiresAt: Date.now() + d.expiresIn * 1000 };
  return { email: d.email };
}

const fresh = () => cached !== null && cached.expiresAt - Date.now() > EXPIRY_MARGIN_MS;

export async function getAccessToken(force = false): Promise<string> {
  if (!force && fresh()) return cached!.token;
  if (refreshing) return refreshing;
  const p = refresh(epoch);
  refreshing = p;
  try {
    return await p;
  } finally {
    if (refreshing === p) refreshing = null;
  }
}

async function refresh(myEpoch: number): Promise<string> {
  // The session changed (signIn/signOut) while this refresh was in flight: drop its result.
  const stale = () => {
    if (fresh()) return cached!.token;
    throw new AuthNeeded();
  };
  const auth = await readAuth();
  if (!auth) throw new AuthNeeded();
  const res = await post('/refresh', { session: auth.session });
  if (myEpoch !== epoch) return stale();
  if (res.status === 401) {
    cached = null;
    await db.transaction('rw', db.meta, async () => {
      const cur = await readAuth();
      if (cur?.session === auth.session) await db.meta.delete('auth');
    });
    throw new AuthNeeded();
  }
  if (!res.ok) throw new Offline(`Token refresh failed (${res.status})`);
  const d = await res.json() as { accessToken: string; expiresIn: number };
  if (myEpoch !== epoch) return stale();
  cached = { token: d.accessToken, expiresAt: Date.now() + d.expiresIn * 1000 };
  return d.accessToken;
}

export async function signOut(): Promise<void> {
  epoch++;
  refreshing = null;
  cached = null;
  const auth = await readAuth();
  if (auth) {
    try { await post('/revoke', { session: auth.session }); } catch { /* best effort */ }
  }
  await db.meta.delete('auth');
}
