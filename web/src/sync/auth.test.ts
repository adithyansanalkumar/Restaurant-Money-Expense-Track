import { describe, it, expect, beforeEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '../db/db';

vi.stubEnv('VITE_AUTH_URL', 'https://auth.test');
vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');

import { getAccessToken, signOut, signIn, currentEmail, AuthNeeded, Offline } from './auth';

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
