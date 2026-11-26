import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db/db';

vi.stubEnv('VITE_AUTH_URL', 'https://auth.test');
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');

import { getAccessToken, signOut, signIn, currentEmail, onAccountChange, disconnectGoogle, AuthNeeded, Offline, AccountSwitch, ConsentRequired, EmailMismatch } from './auth';

const fetchMock = vi.fn();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  await db.meta.clear();
  await signOut().catch(() => {});
  fetchMock.mockReset();
  await db.meta.clear();
});

describe('signIn', () => {
  it('runs the GIS code flow, posts the code, stores session+email', async () => {
    let cb: (r: { code?: string; error?: string }) => void = () => {};
    const requestCode = vi.fn(() => cb({ code: 'CODE' }));
    const initCodeClient = vi.fn((cfg: any) => { cb = cfg.callback; return { requestCode }; });
    (window as any).google = { accounts: { oauth2: { initCodeClient } } };
    fetchMock.mockResolvedValueOnce(json({ session: 'S1', accessToken: 'AT', expiresIn: 3600, email: 'a@b.com' }));
    expect(await signIn()).toEqual({ email: 'a@b.com' });
    expect(initCodeClient.mock.calls[0][0]).toMatchObject({
      client_id: 'cid', scope: 'openid email https://www.googleapis.com/auth/drive.file', ux_mode: 'popup',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/exchange');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ code: 'CODE' });
    expect((await db.meta.get('auth'))?.value).toEqual({ session: 'S1', email: 'a@b.com' });
    expect(await currentEmail()).toBe('a@b.com');
    expect(await getAccessToken()).toBe('AT');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getAccessToken', () => {
  beforeEach(async () => { await db.meta.put({ key: 'auth', value: { session: 'S', email: 'a@b.com' } }); });

  it('refreshes via /refresh and caches', async () => {
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'T1', expiresIn: 3600 }));
    expect(await getAccessToken()).toBe('T1');
    expect(await getAccessToken()).toBe('T1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/refresh');
  });
  it('refreshes when forced or near expiry', async () => {
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'T1', expiresIn: 30 })).mockResolvedValueOnce(json({ accessToken: 'T2', expiresIn: 3600 }));
    expect(await getAccessToken()).toBe('T1');
    expect(await getAccessToken()).toBe('T2');
    fetchMock.mockResolvedValueOnce(json({ accessToken: 'T3', expiresIn: 3600 }));
    expect(await getAccessToken(true)).toBe('T3');
  });
  it('401 clears auth and throws AuthNeeded', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'unauthorized' }, 401));
    await expect(getAccessToken(true)).rejects.toBeInstanceOf(AuthNeeded);
    expect(await db.meta.get('auth')).toBeUndefined();
  });
  it('network failure throws Offline', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('failed'));
    await expect(getAccessToken(true)).rejects.toBeInstanceOf(Offline);
    expect(await db.meta.get('auth')).toBeDefined();
  });
  it('no stored session throws AuthNeeded', async () => {
    await db.meta.clear();
    await expect(getAccessToken(true)).rejects.toBeInstanceOf(AuthNeeded);
  });
});

describe('concurrent refresh', () => {
  const deferred = () => { let resolve!: (r: Response) => void; const p = new Promise<Response>((r) => { resolve = r; }); return { p, resolve }; };
  const gis = (code: string) => {
    let cb: (r: { code?: string }) => void = () => {};
    (window as any).google = { accounts: { oauth2: { initCodeClient: (cfg: any) => { cb = cfg.callback; return { requestCode: () => cb({ code }) }; } } } };
  };
  beforeEach(async () => { await db.meta.put({ key: 'auth', value: { session: 'S', email: 'a@b.com' } }); });

  it('two concurrent calls share one /refresh', async () => {
    const d = deferred();
    fetchMock.mockReturnValueOnce(d.p);
    const a = getAccessToken(true);
    const b = getAccessToken(true);
    d.resolve(json({ accessToken: 'T1', expiresIn: 3600 }));
    expect(await Promise.all([a, b])).toEqual(['T1', 'T1']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('a 401 from a refresh started before a new sign-in does not clear the new session', async () => {
    const d = deferred();
    fetchMock.mockReturnValueOnce(d.p);
    const stale = getAccessToken(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    gis('C2');
    fetchMock.mockResolvedValueOnce(json({ session: 'S2', accessToken: 'AT2', expiresIn: 3600, email: 'c@d.com' }));
    await signIn();
    d.resolve(json({ error: 'unauthorized' }, 401));
    expect(await stale).toBe('AT2');
    expect((await db.meta.get('auth'))?.value).toEqual({ session: 'S2', email: 'c@d.com' });
    expect(await getAccessToken()).toBe('AT2');
  });

  it('a refresh that resolves after signOut is dropped', async () => {
    const d = deferred();
    fetchMock.mockReturnValueOnce(d.p);
    const stale = getAccessToken(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fetchMock.mockResolvedValueOnce(json({}));
    await signOut();
    d.resolve(json({ accessToken: 'OLD', expiresIn: 3600 }));
    await expect(stale).rejects.toBeInstanceOf(AuthNeeded);
    fetchMock.mockReset();
    await expect(getAccessToken()).rejects.toBeInstanceOf(AuthNeeded);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('signOut', () => {
  it('revokes best effort and clears', async () => {
    await db.meta.put({ key: 'auth', value: { session: 'S', email: 'a@b.com' } });
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await signOut();
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/revoke');
    expect(await db.meta.get('auth')).toBeUndefined();
    expect(await currentEmail()).toBeNull();
  });
});

describe('sign-in hardening', () => {
  let codes: string[];
  let requests: number;
  beforeEach(() => {
    codes = ['C1', 'C2', 'C3'];
    requests = 0;
    let cb: (r: { code?: string }) => void = () => {};
    (window as any).google = { accounts: { oauth2: { initCodeClient: (cfg: any) => { cb = cfg.callback; return { requestCode: () => { requests++; cb({ code: codes.shift() }); } }; } } } };
  });
  const ok = (session: string, email: string) => json({ session, accessToken: 'AT-' + session, expiresIn: 3600, email });

  it('409 consent_required throws ConsentRequired without reopening the popup (needs a new tap)', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'consent_required' }, 409));
    await expect(signIn()).rejects.toBeInstanceOf(ConsentRequired);
    expect(requests).toBe(1);
    expect(await db.meta.get('auth')).toBeUndefined();
    // the next tap runs a fresh code flow and succeeds
    fetchMock.mockResolvedValueOnce(ok('S1', 'a@b.com'));
    expect(await signIn()).toEqual({ email: 'a@b.com' });
    expect(requests).toBe(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ code: 'C2' });
  });

  it('re-sign-in revokes the old session before storing the new one', async () => {
    await db.meta.put({ key: 'auth', value: { session: 'OLD', email: 'a@b.com' } });
    fetchMock.mockResolvedValueOnce(ok('NEW', 'a@b.com')).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await signIn();
    expect(fetchMock.mock.calls[1][0]).toBe('https://auth.test/revoke');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ session: 'OLD' });
    expect((await db.meta.get('auth'))?.value).toEqual({ session: 'NEW', email: 'a@b.com' });
  });

  it('same account again keeps ledgerRef and lastSync', async () => {
    await db.meta.bulkPut([
      { key: 'auth', value: { session: 'OLD', email: 'a@b.com' } }, { key: 'account', value: { email: 'a@b.com' } },
      { key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } }, { key: 'lastSync', value: { at: 1, version: '1' } },
    ]);
    const changed = vi.fn();
    const off = onAccountChange(changed);
    fetchMock.mockResolvedValueOnce(ok('NEW', 'A@b.com')).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await signIn();
    off();
    expect(await db.meta.get('ledgerRef')).toBeDefined();
    expect(await db.meta.get('lastSync')).toBeDefined();
    expect(changed).not.toHaveBeenCalled();
  });

  it('a different account than the recorded one throws AccountSwitch: new session revoked, nothing changed', async () => {
    await db.meta.bulkPut([
      { key: 'account', value: { email: 'a@b.com' } },
      { key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } }, { key: 'lastSync', value: { at: 1, version: '1' } },
    ]);
    fetchMock.mockResolvedValueOnce(ok('S2', 'c@d.com')).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const err = await signIn().catch((e) => e);
    expect(err).toBeInstanceOf(AccountSwitch);
    expect(err.email).toBe('c@d.com');
    expect(fetchMock.mock.calls[1][0]).toBe('https://auth.test/revoke');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ session: 'S2' });
    expect(await db.meta.get('auth')).toBeUndefined();
    expect((await db.meta.get('account'))?.value).toEqual({ email: 'a@b.com' });
    expect(await db.meta.get('ledgerRef')).toBeDefined();
    expect(await db.meta.get('lastSync')).toBeDefined();
  });

  it('signing in with no ledgerRef sets adoptPending together with auth; with a ref it does not', async () => {
    fetchMock.mockResolvedValueOnce(ok('S1', 'a@b.com'));
    await signIn();
    expect((await db.meta.get('adoptPending'))?.value).toBe(true);
    await db.meta.delete('adoptPending');
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } });
    fetchMock.mockResolvedValueOnce(ok('S2', 'a@b.com')).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await signIn();
    expect(await db.meta.get('adoptPending')).toBeUndefined();
  });

  it('adoptPending is written in the same transaction as auth (a failed write leaves neither)', async () => {
    fetchMock.mockResolvedValueOnce(ok('S1', 'a@b.com'));
    const orig = db.meta.put.bind(db.meta);
    const spy = vi.spyOn(db.meta, 'put').mockImplementation(((row: any) => {
      if (row.key === 'adoptPending') return Promise.reject(new Error('disk full'));
      return orig(row);
    }) as any);
    await expect(signIn()).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await db.meta.get('auth')).toBeUndefined();
  });

  it('expectEmail mismatch revokes the new session, keeps the old one and throws EmailMismatch', async () => {
    await db.meta.put({ key: 'auth', value: { session: 'OLD', email: 'a@b.com' } });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } });
    fetchMock.mockResolvedValueOnce(ok('WRONG', 'x@y.com')).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const err = await signIn({ expectEmail: 'a@b.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(EmailMismatch);
    expect(err.email).toBe('x@y.com');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ session: 'WRONG' });
    expect((await db.meta.get('auth'))?.value).toEqual({ session: 'OLD', email: 'a@b.com' });
    expect(await db.meta.get('ledgerRef')).toBeDefined();
  });

  it('signOut clears ledgerRef and lastSync and notifies', async () => {
    await db.meta.bulkPut([
      { key: 'auth', value: { session: 'S', email: 'a@b.com' } },
      { key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } }, { key: 'lastSync', value: { at: 1, version: '1' } },
    ]);
    const changed = vi.fn();
    const off = onAccountChange(changed);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await db.meta.bulkPut([{ key: 'account', value: { email: 'a@b.com' } }, { key: 'adoptPending', value: true }]);
    await signOut();
    off();
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
    expect(await db.meta.get('lastSync')).toBeUndefined();
    expect(await db.meta.get('adoptPending')).toBeUndefined();
    expect((await db.meta.get('account'))?.value).toEqual({ email: 'a@b.com' }); // the books are still that account's
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('signOut notifies (sync bumps its generation) before deleting the meta', async () => {
    await db.meta.bulkPut([{ key: 'auth', value: { session: 'S', email: 'a@b.com' } }, { key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } }]);
    let refAtNotify: unknown = 'unset';
    const off = onAccountChange(() => { refAtNotify = 'called'; });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const p = signOut();
    expect(refAtNotify).toBe('called'); // synchronously, before any await
    await p;
    off();
  });

  it('disconnectGoogle posts /disconnect with the session and signs out here', async () => {
    await db.meta.put({ key: 'auth', value: { session: 'S', email: 'a@b.com' } });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await disconnectGoogle();
    expect(fetchMock.mock.calls[0][0]).toBe('https://auth.test/disconnect');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ session: 'S' });
    expect(await db.meta.get('auth')).toBeUndefined();
  });
});
