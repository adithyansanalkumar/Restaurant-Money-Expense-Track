import { db } from '../db/db';

export class AuthNeeded extends Error {
  constructor(message = 'Sign-in required') { super(message); this.name = 'AuthNeeded'; }
}
export class Offline extends Error {
  constructor(message = 'Network unavailable') { super(message); this.name = 'Offline'; }
}
/** Google still gave no refresh token after the one consent retry. */
export class ConsentRequired extends Error {
  constructor(message = 'Access was not approved') { super(message); this.name = 'ConsentRequired'; }
}
/** signIn({ expectEmail }) got a different Google account; nothing was stored. */
export class EmailMismatch extends Error {
  constructor(public email: string) { super('Signed in with a different account'); this.name = 'EmailMismatch'; }
}

export interface SignInOptions {
  /** Called when Google must be asked for consent again (the app shows "Please approve access again"). */
  onConsentRetry?: () => void;
  /** Only accept this account (Forgot PIN). A different one is revoked and EmailMismatch thrown. */
  expectEmail?: string;
}

const GIS_URL = 'https://accounts.google.com/gsi/client';
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.file';
const EXPIRY_MARGIN_MS = 60_000;

interface StoredAuth { session: string; email: string }
/** meta 'account': the last signed-in account, kept after its session expires, so a switch is detected. */
interface StoredAccount { email: string }

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Sign-out and account switches: the ledger location and last-sync are dropped (here, in IndexedDB),
// and listeners (sync) stop their timers.
const accountListeners = new Set<() => void>();
export function onAccountChange(cb: () => void): () => void {
  accountListeners.add(cb);
  return () => { accountListeners.delete(cb); };
}
const notifyAccountChange = () => accountListeners.forEach((l) => { try { l(); } catch { /* listener bug */ } });
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

function requestCode(clientId: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
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
}

async function revokeSession(session: string): Promise<void> {
  try { await post('/revoke', { session }); } catch { /* best effort */ }
}

export async function signIn(opts: SignInOptions = {}): Promise<{ email: string }> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId || !authUrl()) {
    throw new Error('Sign-in is not configured: set VITE_GOOGLE_CLIENT_ID and VITE_AUTH_URL');
  }
  await loadGis();
  let res = await post('/exchange', { code: await requestCode(clientId) });
  if (res.status === 409) {
    // The worker revoked the grant (Google sent no refresh token); Google asks for consent again.
    opts.onConsentRetry?.();
    res = await post('/exchange', { code: await requestCode(clientId) });
    if (res.status === 409) throw new ConsentRequired();
  }
  if (!res.ok) throw new Error('Sign-in failed');
  const d = await res.json() as { session: string; accessToken: string; expiresIn: number; email: string };
  if (opts.expectEmail && !sameEmail(d.email, opts.expectEmail)) {
    await revokeSession(d.session);
    throw new EmailMismatch(d.email);
  }
  epoch++;
  refreshing = null;
  const old = await readAuth();
  if (old && old.session !== d.session) await revokeSession(old.session);
  const last = (await db.meta.get('account'))?.value as StoredAccount | undefined;
  const switched = !!last && !sameEmail(last.email, d.email);
  await db.transaction('rw', db.meta, async () => {
    if (switched) await db.meta.bulkDelete(['ledgerRef', 'lastSync']);
    await db.meta.put({ key: 'auth', value: { session: d.session, email: d.email } satisfies StoredAuth });
    await db.meta.put({ key: 'account', value: { email: d.email } satisfies StoredAccount });
  });
  cached = { token: d.accessToken, expiresAt: Date.now() + d.expiresIn * 1000 };
  if (switched) notifyAccountChange();
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
  if (auth) await revokeSession(auth.session);
  await db.meta.bulkDelete(['auth', 'account', 'ledgerRef', 'lastSync']);
  notifyAccountChange();
}
