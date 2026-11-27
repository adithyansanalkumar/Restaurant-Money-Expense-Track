import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { saveShared, reloadSettings } from '../settings/store';
import type { Ledger } from './merge';

vi.stubEnv('VITE_PICKER_API_KEY', 'PKEY');
vi.stubEnv('VITE_GOOGLE_APP_ID', '1234');

// ---- Drive mocked at the module boundary (no network) ----
const files = new Map<string, { data: unknown; version: number }>();
const drive = {
  ensureFolder: vi.fn(async (_n: string) => 'ownFolder'),
  findFolder: vi.fn(async (_n: string): Promise<string | null> => null),
  listFiles: vi.fn(async () => [] as { id: string; version: string }[]),
  findFile: vi.fn(async (_n: string, _p: string): Promise<{ id: string; version: string } | null> => null),
  readJson: vi.fn(async (id: string) => ({ data: structuredClone(files.get(id)!.data), version: String(files.get(id)!.version) })),
  getVersion: vi.fn(async (id: string) => String(files.get(id)!.version)),
  writeJson: vi.fn(async (id: string | null, _n: string, _p: string, data: unknown) => {
    const fid = id ?? 'created-by-mistake';
    const v = (files.get(fid)?.version ?? 0) + 1;
    files.set(fid, { data: structuredClone(data), version: v });
    return { id: fid, version: String(v) };
  }),
  shareFolder: vi.fn(async () => {}),
  shareFile: vi.fn(async () => {}),
};
vi.mock('./drive', () => Object.fromEntries(
  ['ensureFolder', 'findFolder', 'listFiles', 'findFile', 'readJson', 'getVersion', 'writeJson', 'shareFolder', 'shareFile']
    .map((k) => [k, (...a: unknown[]) => (drive as any)[k](...a)]),
));
const currentEmail = vi.fn(async (): Promise<string | null> => 'adi@x.com');
vi.mock('./auth', async (orig) => ({
  ...(await orig<typeof import('./auth')>()),
  getAccessToken: async () => 'TOK',
  currentEmail: () => currentEmail(),
}));

import { InvalidEmail, NoRestaurant, NotOwner, inviteByEmail, isOwner, isValidEmail, openShared, ownFolderId, PickerCancelled } from './share';
import { resolveLedgerRef, stopSync, syncNow } from './sync';

const owned: Ledger = {
  schema: 1, entries: [], payments: [], suppliers: [], categories: [],
  settings: [{ id: 'shared', updatedAt: 5, deviceId: 'dad', deleted: false, restaurantName: 'Chez Dad', country: 'FR', currency: 'EUR', billLanguage: 'fra', taxView: 'incl', photoBackup: false, ocrMode: 'device', ownerEmail: 'dad@x.com' } as any],
};

// ---- fake Google Picker ----
let picked: { id: string; parentId?: string } | 'cancel' = { id: 'sharedLedger' };
let builderCalls: Record<string, unknown[]>;
function installPicker() {
  builderCalls = {};
  const rec = (name: string) => function (this: any, ...a: unknown[]) { builderCalls[name] = a; return this; };
  class DocsView { constructor(public viewId: string) { builderCalls.view = [viewId]; } }
  for (const m of ['setMimeTypes', 'setQuery', 'setSelectFolderEnabled', 'setIncludeFolders', 'setMode']) (DocsView.prototype as any)[m] = rec(m);
  class PickerBuilder {
    cb: (d: any) => void = () => {};
    addView = rec('addView'); setOAuthToken = rec('setOAuthToken'); setDeveloperKey = rec('setDeveloperKey'); setAppId = rec('setAppId');
    setCallback(cb: (d: any) => void) { this.cb = cb; return this; }
    build() {
      const cb = this.cb;
      return { setVisible: () => setTimeout(() => cb(picked === 'cancel'
        ? { action: 'cancel' }
        : { action: 'picked', docs: [{ id: picked.id, parentId: picked.parentId, name: 'ledger.json' }] })) };
    }
  }
  (window as any).google = { ...(window as any).google, picker: {
    DocsView, PickerBuilder, ViewId: { DOCS: 'docs', FOLDERS: 'folders' }, DocsViewMode: { LIST: 'list' },
    Action: { PICKED: 'picked', CANCEL: 'cancel' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Document: { ID: 'id', PARENT_ID: 'parentId' },
  } };
  (window as any).gapi = { load: (_name: string, o: { callback: () => void }) => o.callback() };
}

beforeEach(async () => {
  stopSync();
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  files.clear();
  for (const f of Object.values(drive)) f.mockClear();
  drive.findFile.mockImplementation(async () => null);
  drive.findFolder.mockImplementation(async () => null);
  currentEmail.mockReset().mockResolvedValue('adi@x.com');
  picked = { id: 'sharedLedger' };
  installPicker();
});
afterEach(() => stopSync());

describe('inviteByEmail', () => {
  it.each(['', 'nope', 'a@b', 'a b@c.com', '@c.com', 'a@b.c d'])('refuses %j before any request', async (bad) => {
    await expect(inviteByEmail(bad)).rejects.toBeInstanceOf(InvalidEmail);
    for (const f of Object.values(drive)) expect(f).not.toHaveBeenCalled();
  });
  it('validates simply', () => {
    expect(isValidEmail('son@gmail.com')).toBe(true);
    expect(isValidEmail(' son@gmail.com ')).toBe(true);
    expect(isValidEmail('son@@gmail.com')).toBe(false);
  });
  it('owner: shares the ledger folder (writer, notified) with the trimmed address', async () => {
    await saveShared({ restaurantName: 'R', ownerEmail: 'adi@x.com' });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
    await inviteByEmail('  son@gmail.com ');
    expect(drive.shareFolder).toHaveBeenCalledWith('F1', 'son@gmail.com');
    expect(drive.shareFile).not.toHaveBeenCalled();
  });
  it('records the invited email in shared settings (sharedWith), once, unless adoptPending', async () => {
    await saveShared({ restaurantName: 'R', ownerEmail: 'adi@x.com' });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
    await inviteByEmail('son@gmail.com');
    await inviteByEmail('SON@gmail.com');
    expect((await db.settings.get('shared'))!.sharedWith).toEqual(['son@gmail.com']);
    await db.meta.put({ key: 'adoptPending', value: true });
    const before = await db.settings.get('shared');
    await inviteByEmail('other@gmail.com');
    expect(await db.settings.get('shared')).toEqual(before); // the invite went out; nothing shared was written
    await db.meta.delete('adoptPending');
  });
  it('a ledger ref with no folderId shares the file itself', async () => {
    await saveShared({ restaurantName: 'R', ownerEmail: 'adi@x.com' });
    await db.meta.put({ key: 'ledgerRef', value: { fileId: 'L1', joined: true } });
    await inviteByEmail('son@gmail.com');
    expect(drive.shareFile).toHaveBeenCalledWith('L1', 'son@gmail.com');
    expect(drive.shareFolder).not.toHaveBeenCalled();
  });
  it('not the owner: refused, no request', async () => {
    await saveShared({ restaurantName: 'R', ownerEmail: 'dad@x.com' });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
    await expect(inviteByEmail('son@gmail.com')).rejects.toBeInstanceOf(NotOwner);
    expect(drive.shareFolder).not.toHaveBeenCalled();
  });
});

describe('isOwner', () => {
  it('ownerEmail equal to the signed-in email (case-insensitive)', async () => {
    await saveShared({ ownerEmail: 'Adi@X.com' });
    expect(await isOwner()).toBe(true);
    currentEmail.mockResolvedValue('other@x.com');
    expect(await isOwner()).toBe(false);
  });
  it('no ownerEmail: owner unless this phone joined', async () => {
    await saveShared({ restaurantName: 'R' });
    expect(await isOwner()).toBe(true);
    await db.meta.put({ key: 'ledgerRef', value: { fileId: 'L', joined: true } });
    expect(await isOwner()).toBe(false);
  });
});

describe('openShared', () => {
  it('file mode: Picker filtered to ledger.json, stores a joined ref, then syncs the picked ledger (never creates one)', async () => {
    files.set('sharedLedger', { data: owned, version: 7 });
    await db.meta.bulkPut([{ key: 'ledgerRef', value: { folderId: 'old', fileId: 'oldL' } }, { key: 'lastSync', value: { at: 1, version: '1' } }]);
    await openShared();
    expect(builderCalls.view).toEqual(['docs']);
    expect(builderCalls.setMimeTypes).toEqual(['application/json']);
    expect(builderCalls.setQuery).toEqual(['ledger.json']);
    expect(builderCalls.setOAuthToken).toEqual(['TOK']);
    expect(builderCalls.setDeveloperKey).toEqual(['PKEY']);
    expect(builderCalls.setAppId).toEqual(['1234']);
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ fileId: 'sharedLedger', joined: true });
    expect(drive.readJson).toHaveBeenCalledWith('sharedLedger');
    expect(drive.writeJson.mock.calls.every((c) => c[0] === 'sharedLedger')).toBe(true);
    expect(drive.ensureFolder).not.toHaveBeenCalled();
    // adopted the owner's shared settings, untouched
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Chez Dad', updatedAt: 5, deviceId: 'dad' });
  });

  it('a joined ref is returned unchanged and never re-checked or replaced', async () => {
    files.set('sharedLedger', { data: owned, version: 7 });
    await db.meta.put({ key: 'ledgerRef', value: { fileId: 'sharedLedger', joined: true } });
    drive.findFolder.mockResolvedValue('myOwnFolder');
    drive.findFile.mockResolvedValue({ id: 'myOwnLedger', version: '1' });
    expect(await resolveLedgerRef()).toEqual({ fileId: 'sharedLedger', joined: true });
    expect((await syncNow()).status).toBe('ok');
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ fileId: 'sharedLedger', joined: true });
    expect(drive.findFolder).not.toHaveBeenCalled();
    expect(drive.findFile).not.toHaveBeenCalled();
  });

  it('folder mode: picks the folder, then finds ledger.json inside it', async () => {
    files.set('L-in-folder', { data: owned, version: 3 });
    picked = { id: 'sharedFolder' };
    drive.findFile.mockImplementation(async (_n, p) => (p === 'sharedFolder' ? { id: 'L-in-folder', version: '3' } : null));
    await openShared('folder');
    expect(builderCalls.view).toEqual(['folders']);
    expect(builderCalls.setSelectFolderEnabled).toEqual([true]);
    expect(drive.findFile).toHaveBeenCalledWith('ledger.json', 'sharedFolder');
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'sharedFolder', fileId: 'L-in-folder', joined: true });
  });

  it('folder mode with no ledger.json: throws and stores nothing', async () => {
    picked = { id: 'emptyFolder' };
    await expect(openShared('folder')).rejects.toThrow(/ledger/i);
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
  });

  it('cancelling the Picker throws PickerCancelled and keeps the old ref', async () => {
    picked = 'cancel';
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'old', fileId: 'oldL' } });
    await expect(openShared()).rejects.toBeInstanceOf(PickerCancelled);
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'old', fileId: 'oldL' });
  });

  it('never writes shared settings while joining', async () => {
    files.set('sharedLedger', { data: owned, version: 7 });
    await openShared();
    const pushed = files.get('sharedLedger')!.data as Ledger;
    expect(pushed.settings).toEqual(owned.settings);
  });
});

describe('ownFolderId', () => {
  it('ensures this account\'s own "Restaurant Accounts" folder', async () => {
    expect(await ownFolderId()).toBe('ownFolder');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Restaurant Accounts');
  });
});

describe('joining from a phone that was used signed out ("Not now")', () => {
  const localRow = async () => {
    await saveShared({ restaurantName: 'My local', country: 'FR', currency: 'EUR' }); // newer than the owner's
    await db.entries.put({ id: 'offline1', updatedAt: 50, deviceId: 'me', deleted: false, kind: 'expense', date: '2026-11-01', amountIncl: 700, categoryId: 'c', method: 'cash', createdBy: '' } as any);
  };
  it('the local shared row is removed raw before the first sync: the owner\'s settings survive, local entries merge in', async () => {
    await localRow();
    files.set('sharedLedger', { data: owned, version: 7 });
    await openShared();
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Chez Dad', updatedAt: 5, deviceId: 'dad', deleted: false });
    const pushed = files.get('sharedLedger')!.data as Ledger;
    expect(pushed.settings).toEqual(owned.settings); // no tombstone, no local row
    expect(pushed.entries.map((e) => e.id)).toEqual(['offline1']);
  });
  it('the sync fails: the local row comes back and the joined ref is dropped', async () => {
    await localRow();
    drive.readJson.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'Offline' }));
    await expect(openShared()).rejects.toThrow();
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'My local' });
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
  });
});

describe('joining with entries already on the phone (I2)', () => {
  const localBooks = async () => {
    await saveShared({ restaurantName: 'Test resto', country: 'FR', currency: 'EUR' });
    await db.entries.put({ id: 'test1', updatedAt: 50, deviceId: 'me', deleted: false, kind: 'expense', date: '2026-11-01', amountIncl: 700, categoryId: 'c', method: 'cash', createdBy: '' } as any);
    await db.suppliers.put({ id: 'sup1', updatedAt: 50, deviceId: 'me', deleted: false, name: 'Test shop' } as any);
    await db.photos.put({ id: 'ph1', blob: new Blob(['x']), createdAt: 1, backedUp: false });
    await db.meta.put({ key: 'auth', value: { session: 'S', email: 'adi@x.com' } });
  };
  it('countLocalEntries counts live entries only', async () => {
    const { countLocalEntries } = await import('./share');
    await localBooks();
    await db.entries.put({ id: 'gone', updatedAt: 51, deviceId: 'me', deleted: true } as any);
    expect(await countLocalEntries()).toBe(1);
  });
  it('erase first: the local books are cleared raw (no tombstones reach the shared ledger), still signed in', async () => {
    await localBooks();
    files.set('sharedLedger', { data: owned, version: 7 });
    await openShared('file', { eraseLocal: true });
    const pushed = files.get('sharedLedger')!.data as Ledger;
    expect(pushed.entries).toEqual([]);
    expect(pushed.suppliers).toEqual([]);
    expect(await db.entries.count()).toBe(0);
    expect(await db.photos.count()).toBe(0);
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Chez Dad' });
    expect(await db.meta.get('auth')).toBeDefined();
  });
  it('add them: local entries merge into the shared ledger', async () => {
    await localBooks();
    files.set('sharedLedger', { data: owned, version: 7 });
    await openShared('file');
    const pushed = files.get('sharedLedger')!.data as Ledger;
    expect(pushed.entries.map((e) => e.id)).toEqual(['test1']);
    expect(await db.photos.count()).toBe(1);
  });
  it('erase first, but the picker is cancelled: nothing is erased', async () => {
    await localBooks();
    picked = 'cancel';
    try {
      await expect(openShared('file', { eraseLocal: true })).rejects.toBeInstanceOf(PickerCancelled);
    } finally { picked = { id: 'sharedLedger' }; }
    expect(await db.entries.count()).toBe(1);
  });
});

describe('openShared rollbacks and adoptPending', () => {
  it('a ledger without a restaurant: NoRestaurant, no joined ref left, local row restored', async () => {
    await saveShared({ restaurantName: 'Mine' });
    files.set('sharedLedger', { data: { ...owned, settings: [] }, version: 7 });
    await expect(openShared()).rejects.toBeInstanceOf(NoRestaurant);
    expect(await db.meta.get('ledgerRef')).toBeUndefined();
    expect(await db.settings.get('shared')).toMatchObject({ restaurantName: 'Mine' });
  });
  it('joins while adoptPending is set (bypass) and clears it on success', async () => {
    await db.meta.put({ key: 'adoptPending', value: true });
    files.set('sharedLedger', { data: owned, version: 7 });
    await openShared();
    expect(drive.readJson).toHaveBeenCalledWith('sharedLedger');
    expect(await db.meta.get('adoptPending')).toBeUndefined();
  });
  it('a failed join keeps adoptPending', async () => {
    await db.meta.put({ key: 'adoptPending', value: true });
    drive.readJson.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'Offline' }));
    await expect(openShared()).rejects.toThrow();
    expect((await db.meta.get('adoptPending'))?.value).toBe(true);
  });
});
