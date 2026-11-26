import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { reloadSettings } from '../settings/store';
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
vi.mock('./auth', async (orig) => ({ ...(await orig<typeof import('./auth')>()), getAccessToken: async () => 'TOK', currentEmail: async () => 'dad@x.com' }));

import { adoptExistingLedger } from './onboard';
import { stopSync } from './sync';

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
