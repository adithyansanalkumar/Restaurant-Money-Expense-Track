import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { reloadSettings, saveShared } from '../settings/store';
import type { Ledger } from './merge';

const files = new Map<string, { data: unknown; version: number }>();
const drive = {
  ensureFolder: vi.fn(async () => 'F'),
  findFolder: vi.fn(async (): Promise<string | null> => null),
  listFiles: vi.fn(async () => []),
  findFile: vi.fn(async (): Promise<{ id: string; version: string } | null> => null),
  readJson: vi.fn(async (id: string) => ({ data: structuredClone(files.get(id)!.data), version: String(files.get(id)!.version) })),
  getVersion: vi.fn(async (id: string) => String(files.get(id)!.version)),
  writeJson: vi.fn(async (id: string | null, _n: string, _p: string, data: unknown) => {
    const fid = id ?? 'new';
    const v = (files.get(fid)?.version ?? 0) + 1;
    files.set(fid, { data: structuredClone(data), version: v });
    return { id: fid, version: String(v) };
  }),
};
vi.mock('./drive', () => Object.fromEntries(['ensureFolder', 'findFolder', 'listFiles', 'findFile', 'readJson', 'getVersion', 'writeJson'].map((k) => [k, (...a: unknown[]) => (drive as any)[k](...a)])));
const signOut = vi.fn(async () => {});
const signIn = vi.fn(async (_o?: unknown) => ({ email: 'dad@x.com' }));
const me = vi.hoisted(() => ({ email: 'dad@x.com' as string | null }));
const realAuth = vi.hoisted(() => ({} as Partial<typeof import('./auth')>));
vi.mock('./auth', async (orig) => {
  const mod = await orig<typeof import('./auth')>();
  Object.assign(realAuth, mod);
  return { ...mod, getAccessToken: async () => 'TOK', currentEmail: async () => me.email, signOut: () => signOut(), signIn: (o?: unknown) => signIn(o) };
});

import { adoptExistingLedger, resumeAdoptionIfPending, signInLater } from './onboard';
import { stopSync, syncNow } from './sync';

const ledger: Ledger = {
  schema: 1, entries: [], payments: [], suppliers: [],
  categories: [{ id: 'cat:expense:0', updatedAt: 3, deviceId: 'old', deleted: false, kind: 'expense', name: 'Food', order: 0 } as any],
  settings: [{ id: 'shared', updatedAt: 5, deviceId: 'oldphone', deleted: false, restaurantName: 'Chez Dad', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device', ownerEmail: 'dad@x.com' } as any],
};

beforeEach(async () => {
  stopSync();
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  files.clear();
  for (const f of Object.values(drive)) f.mockClear();
  signOut.mockClear();
  signIn.mockReset();
  signIn.mockImplementation(async () => ({ email: 'dad@x.com' }));
  me.email = 'dad@x.com';
  drive.findFolder.mockImplementation(async () => null);
  drive.findFile.mockImplementation(async () => null);
});
afterEach(() => stopSync());

describe('adoptExistingLedger (same account, new phone)', () => {
  it('a ledger exists: syncs first and adopts its shared settings without writing them', async () => {
    files.set('L', { data: ledger, version: 9 });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    expect(await adoptExistingLedger()).toBe('adopted');
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Chez Dad', updatedAt: 5, deviceId: 'oldphone' });
    expect(await db.categories.count()).toBe(1);
    expect((await db.meta.get('ledgerRef'))?.value).toMatchObject({ folderId: 'F', fileId: 'L' });
    expect(drive.writeJson).not.toHaveBeenCalled(); // nothing new to push
    expect(drive.ensureFolder).not.toHaveBeenCalled();
  });
  it('no folder: returns none and creates nothing', async () => {
    expect(await adoptExistingLedger()).toBe('none');
    expect(drive.ensureFolder).not.toHaveBeenCalled();
    expect(drive.writeJson).not.toHaveBeenCalled();
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
  });
  it('folder but no ledger.json: none', async () => {
    drive.findFolder.mockResolvedValue('F');
    expect(await adoptExistingLedger()).toBe('none');
  });
  it('the sync fails: returns the failed status, no shared settings written', async () => {
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    drive.readJson.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'Offline' }));
    expect(await adoptExistingLedger()).toBe('offline');
    expect(await db.settings.get('shared')).toBeUndefined();
  });
});

describe('a "Not now" phone signing in later', () => {
  const localData = async () => {
    await saveShared({ restaurantName: 'Local', country: 'FR', currency: 'EUR' });
    await db.entries.put({ id: 'offline1', updatedAt: 50, deviceId: 'me', deleted: false, kind: 'expense', date: '2026-11-01', amountIncl: 700, categoryId: 'c', method: 'cash', createdBy: '' } as any);
  };
  it('a ledger exists: the local shared row is removed raw first; the owner\'s settings survive and local entries merge in', async () => {
    await localData();
    files.set('L', { data: ledger, version: 9 });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    expect(await adoptExistingLedger()).toBe('adopted');
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Chez Dad', updatedAt: 5, deleted: false });
    const pushed = files.get('L')!.data as Ledger;
    expect(pushed.settings).toEqual(ledger.settings);
    expect(pushed.entries.map((e) => e.id)).toEqual(['offline1']);
  });
  it('the sync fails: the local row is restored, the ref dropped and adoptPending kept (background sync stays off)', async () => {
    await localData();
    await db.meta.put({ key: 'adoptPending', value: true });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    drive.readJson.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'Offline' }));
    expect(await adoptExistingLedger()).toBe('offline');
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Local' });
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
    expect((await db.meta.get('adoptPending'))?.value).toBe(true);
    expect(signOut).not.toHaveBeenCalled();
    drive.readJson.mockClear();
    expect((await syncNow()).status).toBe('pending');
    expect(drive.readJson).not.toHaveBeenCalled();
  });
  it('adopted: adoptPending cleared', async () => {
    await db.meta.put({ key: 'adoptPending', value: true });
    files.set('L', { data: ledger, version: 9 });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    expect(await adoptExistingLedger()).toBe('adopted');
    expect(await db.meta.get('adoptPending')).toBeUndefined();
  });
  it('no ledger: this phone is the owner (ownerEmail on the local restaurant) and adoptPending cleared', async () => {
    await localData();
    await db.meta.put({ key: 'adoptPending', value: true });
    expect(await adoptExistingLedger()).toBe('none');
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Local', ownerEmail: 'dad@x.com' });
    expect(await db.meta.get('adoptPending')).toBeUndefined();
  });
  it('a ledger with no restaurant in it: rolls back to the local row as owner (none)', async () => {
    await localData();
    files.set('L', { data: { ...ledger, settings: [] }, version: 9 });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    expect(await adoptExistingLedger()).toBe('none');
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Local', ownerEmail: 'dad@x.com' });
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
  });
  it('lookup fails: adoptPending kept, nothing written', async () => {
    await db.meta.put({ key: 'adoptPending', value: true });
    drive.findFolder.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'Offline' }));
    expect(await adoptExistingLedger()).toBe('offline');
    expect((await db.meta.get('adoptPending'))?.value).toBe(true);
  });
});

describe('signInLater', () => {
  it('no ledger chosen: signs in, then adopts', async () => {
    files.set('L', { data: ledger, version: 9 });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    expect(await signInLater({ expectEmail: 'dad@x.com' })).toEqual({ email: 'dad@x.com', result: 'adopted' });
    expect(signIn).toHaveBeenCalledWith({ expectEmail: 'dad@x.com' });
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Chez Dad' });
  });
  it('a ledger already chosen: signs in and syncs, no adoption lookup', async () => {
    files.set('L', { data: ledger, version: 9 });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F', fileId: 'L' } });
    expect(await signInLater()).toEqual({ email: 'dad@x.com', result: 'kept' });
    expect(drive.findFolder).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(drive.readJson).toHaveBeenCalledWith('L'));
  });
  it('sign-in errors propagate (ConsentRequired / AccountSwitch are handled by the UI)', async () => {
    const { AccountSwitch } = await import('./auth');
    signIn.mockRejectedValueOnce(new AccountSwitch('x@y.com'));
    await expect(signInLater()).rejects.toBeInstanceOf(AccountSwitch);
  });
});

describe('resume and dedupe', () => {
  it('app start: adoptPending + a session → runs the lookup once in the background (no popup)', async () => {
    await db.meta.put({ key: 'adoptPending', value: true });
    files.set('L', { data: ledger, version: 9 });
    drive.findFolder.mockResolvedValue('F');
    drive.findFile.mockResolvedValue({ id: 'L', version: '9' });
    expect(await resumeAdoptionIfPending()).toBe('adopted');
    expect(signIn).not.toHaveBeenCalled();
    expect(await db.meta.get('adoptPending')).toBeUndefined();
  });
  it('nothing pending: no lookup', async () => {
    expect(await resumeAdoptionIfPending()).toBeNull();
    expect(drive.findFolder).not.toHaveBeenCalled();
  });
  it('overlapping calls share one lookup', async () => {
    const [a, b] = await Promise.all([adoptExistingLedger(), adoptExistingLedger()]);
    expect([a, b]).toEqual(['none', 'none']);
    expect(drive.findFolder).toHaveBeenCalledTimes(1);
  });
});

describe('a phone that joined someone else\'s restaurant (C1)', () => {
  const joinedLocal = async () => {
    await db.settings.put({ ...(ledger.settings[0] as any) });
    await db.entries.put({ id: 'e1', updatedAt: 50, deviceId: 'me', deleted: false, kind: 'expense', date: '2026-11-01', amountIncl: 700, categoryId: 'c', method: 'cash', createdBy: 'adi@x.com' } as any);
    await reloadSettings();
  };
  it('former joiner signs back in: the same account gets its joined ref back; no new ledger, ownerEmail unchanged', async () => {
    vi.stubEnv('VITE_AUTH_URL', 'https://auth.test');
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cid');
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/exchange')
      ? new Response(JSON.stringify({ session: 'S2', accessToken: 'AT', expiresIn: 3600, email: 'adi@x.com' }), { status: 200 })
      : new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    let cb: (r: { code?: string }) => void = () => {};
    (window as any).google = { accounts: { oauth2: { initCodeClient: (cfg: any) => { cb = cfg.callback; return { requestCode: () => cb({ code: 'C' }) }; } } } };
    try {
      me.email = 'adi@x.com';
      files.set('L', { data: ledger, version: 9 });
      await joinedLocal();
      await db.meta.bulkPut([
        { key: 'auth', value: { session: 'S1', email: 'adi@x.com' } }, { key: 'account', value: { email: 'adi@x.com' } },
        { key: 'ledgerRef', value: { fileId: 'L', joined: true } },
      ]);
      await realAuth.signOut!();
      expect(await db.meta.get('ledgerRef')).toBeUndefined();
      signIn.mockImplementation((o?: unknown) => realAuth.signIn!(o as never));
      expect((await signInLater()).result).toBe('kept');
      expect((await db.meta.get('ledgerRef'))?.value).toEqual({ fileId: 'L', joined: true });
      expect(await db.meta.get('adoptPending')).toBeUndefined();
      await vi.waitFor(() => expect(drive.readJson).toHaveBeenCalledWith('L'));
      await vi.waitFor(() => expect(files.get('L')!.version).toBe(10)); // e1 pushed to the shared file
      expect(drive.findFolder).not.toHaveBeenCalled();
      expect(drive.ensureFolder).not.toHaveBeenCalled();
      expect(files.has('new')).toBe(false); // no ledger of its own
      expect(await db.settings.get('shared')).toMatchObject({ ownerEmail: 'dad@x.com', restaurantName: 'Chez Dad' });
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
  it('the local restaurant belongs to another account: needsJoin, ownerEmail never stamped over, nothing looked up or written', async () => {
    me.email = 'adi@x.com';
    await joinedLocal();
    await db.meta.put({ key: 'adoptPending', value: true });
    expect(await adoptExistingLedger()).toBe('needsJoin');
    expect(await db.settings.get('shared')).toMatchObject({ ownerEmail: 'dad@x.com', updatedAt: 5 });
    expect((await db.meta.get('adoptPending'))?.value).toBe(true); // background sync stays off until Join
    expect(drive.findFolder).not.toHaveBeenCalled();
    expect(drive.writeJson).not.toHaveBeenCalled();
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
  });
  it('the owner\'s own email (any case) is not needsJoin', async () => {
    me.email = 'DAD@x.com';
    await joinedLocal();
    expect(await adoptExistingLedger()).toBe('none');
  });
});
