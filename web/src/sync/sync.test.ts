import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { put, softDelete } from '../db/repo';
import type { Entry, Supplier } from '../domain/types';
import type { Ledger } from './merge';

// ---- in-memory Drive, mocked at the module boundary ----
const files = new Map<string, { data: unknown; version: number }>();
let nextId = 1;
const readImpl = async (id: string) => {
  const f = files.get(id)!;
  return { data: structuredClone(f.data), version: String(f.version) };
};
const drive = {
  ensureFolder: vi.fn(async () => 'folder1'),
  findFile: vi.fn(async (name: string) => {
    const f = files.get('ledger1');
    return name === 'ledger.json' && f ? { id: 'ledger1', version: String(f.version) } : null;
  }),
  readJson: vi.fn(async (id: string) => readImpl(id)),
  getVersion: vi.fn(async (id: string) => String(files.get(id)!.version)),
  writeJson: vi.fn(async (id: string | null, _name: string, _parent: string, data: unknown) => {
    const fid = id ?? (nextId++ === 1 ? 'ledger1' : `ledger${nextId}`);
    const prev = files.get(fid);
    const version = (prev?.version ?? 0) + 1;
    files.set(fid, { data: structuredClone(data), version });
    return { id: fid, version: String(version) };
  }),
};
vi.mock('./drive', () => ({
  ensureFolder: (...a: unknown[]) => (drive.ensureFolder as any)(...a),
  findFile: (...a: unknown[]) => (drive.findFile as any)(...a),
  readJson: (...a: unknown[]) => (drive.readJson as any)(...a),
  getVersion: (...a: unknown[]) => (drive.getVersion as any)(...a),
  writeJson: (...a: unknown[]) => (drive.writeJson as any)(...a),
}));
const getAccessToken = vi.fn(async () => 'TOK');
const currentEmail = vi.fn(async (): Promise<string | null> => 'a@b.com');
vi.mock('./auth', async (orig) => ({
  ...(await orig<typeof import('./auth')>()),
  getAccessToken: () => getAccessToken(),
  currentEmail: () => currentEmail(),
}));

import { AuthNeeded, Offline } from './auth';
import { _pendingSync, getSyncState, scheduleSync, startSync, stopSync, syncNow } from './sync';

const empty = (): Ledger => ({ schema: 1, entries: [], payments: [], suppliers: [], categories: [], settings: [] });
const entry = (p: Partial<Entry>): Entry => ({
  id: 'X', updatedAt: 1, deviceId: 'phoneB', deleted: false, kind: 'expense', date: '2026-11-01', amountIncl: 1000,
  categoryId: 'c', method: 'cash', createdBy: 'b', ...p,
});
const remote = () => files.get('ledger1')!.data as Ledger;
const snapshot = async () => {
  const out: Record<string, unknown[]> = {};
  for (const t of ['entries', 'payments', 'suppliers', 'categories', 'settings', 'meta'] as const) out[t] = await db[t].toArray();
  return out;
};

beforeEach(async () => {
  stopSync();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(db.tables.map((t) => t.clear()));
  files.clear();
  nextId = 1;
  for (const f of Object.values(drive)) f.mockClear();
  getAccessToken.mockReset().mockResolvedValue('TOK');
  currentEmail.mockReset().mockResolvedValue('a@b.com');
});
afterEach(() => { stopSync(); vi.useRealTimers(); });

describe('syncNow', () => {
  it('reads ledger.json, merges, writes back and applies the merged result to IndexedDB (raw, not restamped)', async () => {
    files.set('ledger1', { version: 4, data: { ...empty(), entries: [entry({ id: 'R1', updatedAt: 50 }), entry({ id: 'R2', updatedAt: 60, deleted: true })] } });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    const r = await syncNow();
    expect(r.status).toBe('ok');
    expect(drive.readJson).toHaveBeenCalledWith('ledger1');
    expect(drive.writeJson).toHaveBeenCalledTimes(1);
    expect(drive.writeJson.mock.calls[0][0]).toBe('ledger1');
    expect(remote().schema).toBe(1);
    expect(remote().suppliers.map((s) => s.id)).toEqual(['L1']);
    expect(remote().entries.map((e) => e.id)).toEqual(['R1', 'R2']);
    const r1 = await db.entries.get('R1');
    expect(r1).toEqual(entry({ id: 'R1', updatedAt: 50 }));
    expect((await db.entries.get('R2'))?.deleted).toBe(true);
    expect((await db.meta.get('lastSync'))?.value).toEqual({ at: r.at, version: '5' });
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'folder1', fileId: 'ledger1' });
  });

  it('creates ledger.json in "Restaurant Accounts" when none exists, then reuses the stored ref', async () => {
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    expect((await syncNow()).status).toBe('ok');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Restaurant Accounts');
    expect(drive.writeJson.mock.calls[0].slice(0, 3)).toEqual([null, 'ledger.json', 'folder1']);
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'folder1', fileId: 'ledger1' });
    drive.ensureFolder.mockClear(); drive.findFile.mockClear();
    await put<Supplier>('suppliers', { id: 'L2', name: 'Local 2' });
    expect((await syncNow()).status).toBe('ok');
    expect(drive.ensureFolder).not.toHaveBeenCalled();
    expect(drive.findFile).not.toHaveBeenCalled();
    expect(remote().suppliers.map((s) => s.id)).toEqual(['L1', 'L2']);
  });

  it('re-reads and re-merges when the version changed between read and write', async () => {
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'R1' })] } });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' }); // something to push
    let bumps = 2;
    drive.getVersion.mockImplementation(async (id: string) => {
      if (bumps-- > 0) { // the other phone writes in between
        const f = files.get(id)!;
        const d = f.data as Ledger;
        files.set(id, { version: f.version + 1, data: { ...d, entries: [...d.entries, entry({ id: `B${f.version}` })] } });
      }
      return String(files.get(id)!.version);
    });
    const r = await syncNow();
    expect(r.status).toBe('ok');
    expect(drive.readJson).toHaveBeenCalledTimes(3);
    expect(drive.writeJson).toHaveBeenCalledTimes(1);
    expect(remote().entries.map((e) => e.id)).toEqual(['B1', 'B2', 'R1']);
    expect((await db.entries.toArray()).map((e) => e.id)).toEqual(['B1', 'B2', 'R1']);
  });

  it('gives up with status error after 3 attempts, writing nothing and leaving local data untouched', async () => {
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'R1' })] } });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    let v = 100;
    drive.getVersion.mockImplementation(async () => String(v++));
    const before = await snapshot();
    const r = await syncNow();
    expect(r.status).toBe('error');
    expect(drive.readJson).toHaveBeenCalledTimes(3);
    expect(drive.writeJson).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('offline: local data untouched, status offline', async () => {
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'R1' })] } });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'folder1', fileId: 'ledger1' } });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    drive.readJson.mockRejectedValueOnce(new Offline());
    const before = await snapshot();
    const r = await syncNow();
    expect(r.status).toBe('offline');
    expect(r.at).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
    expect(drive.writeJson).not.toHaveBeenCalled();
  });

  it('authNeeded when getAccessToken throws AuthNeeded', async () => {
    getAccessToken.mockRejectedValue(new AuthNeeded());
    const before = await snapshot();
    expect((await syncNow()).status).toBe('authNeeded');
    expect(getSyncState().status).toBe('authNeeded');
    expect(await snapshot()).toEqual(before);
  });

  it('never throws: an unexpected failure is status error with the message kept', async () => {
    files.set('ledger1', { version: 1, data: empty() });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    drive.writeJson.mockRejectedValueOnce(new Error('Drive request failed (500)'));
    const before = await snapshot();
    const r = await syncNow();
    expect(r).toMatchObject({ status: 'error', message: 'Drive request failed (500)' });
    expect(await snapshot()).toEqual(before);
  });

  it('rejects a remote file whose schema is not 1 (status error, no writes)', async () => {
    files.set('ledger1', { version: 1, data: { ...empty(), schema: 2, entries: [entry({ id: 'R1' })] } });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    const before = await snapshot();
    expect((await syncNow()).status).toBe('error');
    expect(drive.writeJson).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
  });

  it('running twice produces no duplicate records (and the second run has nothing to write)', async () => {
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'R1' })] } });
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    await syncNow();
    await syncNow();
    expect(await db.entries.count()).toBe(1);
    expect(await db.suppliers.count()).toBe(1);
    expect(remote().entries).toHaveLength(1);
    expect(remote().suppliers).toHaveLength(1);
    expect(drive.writeJson).toHaveBeenCalledTimes(1);
  });

  it('two phones converge, with an edit-vs-delete resolved by updatedAt', async () => {
    // phone A wrote the ledger earlier
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'X', updatedAt: 10, deviceId: 'phoneA', amountIncl: 5000 })] } });
    await db.entries.put(entry({ id: 'X', updatedAt: 5, deviceId: 'me' }));
    vi.spyOn(Date, 'now').mockReturnValue(12);
    await softDelete('entries', 'X');
    vi.restoreAllMocks();
    await syncNow();
    expect(remote().entries[0]).toMatchObject({ id: 'X', deleted: true, updatedAt: 12 });
    expect((await db.entries.get('X'))?.deleted).toBe(true);
  });

  it('only one sync runs at a time: a second call returns the running promise', async () => {
    files.set('ledger1', { version: 1, data: empty() });
    const a = syncNow();
    const b = syncNow();
    expect(b).toBe(a);
    await a;
    expect(drive.readJson).toHaveBeenCalledTimes(1);
  });

  it('a local write made while the sync is in flight is never overwritten', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    await put<Entry>('entries', entry({ id: 'X', amountIncl: 1000 }));
    vi.restoreAllMocks();
    // remote has a newer version of X than our snapshot (200 > 100)
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'X', updatedAt: 200, deviceId: 'phoneB', amountIncl: 2000 })] } });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'folder1', fileId: 'ledger1' } });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    drive.readJson.mockImplementationOnce(async (id: string) => { await gate; return readImpl(id); });
    const p = syncNow();
    await vi.waitFor(() => expect(drive.readJson).toHaveBeenCalled());
    await put<Entry>('entries', entry({ id: 'X', amountIncl: 3333 })); // user edits now (updatedAt = real now)
    release();
    expect(await p).toMatchObject({ status: 'ok' });
    expect((await db.entries.get('X'))?.amountIncl).toBe(3333);
  });
});

describe('scheduleSync and hooks', () => {
  it('a local write schedules a debounced sync 5 s later', async () => {
    files.set('ledger1', { version: 1, data: empty() });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await startSync();
    await vi.waitFor(() => expect(drive.readJson).toHaveBeenCalledTimes(1), { timeout: 2000 }); // the app-open sync
    await vi.waitFor(() => expect(getSyncState().running).toBe(false));
    drive.readJson.mockClear();
    expect(_pendingSync()).toBe(false);
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    await put<Supplier>('suppliers', { id: 'L2', name: 'Local' });
    expect(_pendingSync()).toBe(true);
    vi.advanceTimersByTime(4999);
    expect(drive.readJson).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    vi.useRealTimers();
    await vi.waitFor(() => expect(remote().suppliers).toHaveLength(2));
    expect(drive.readJson).toHaveBeenCalledTimes(1);
  });

  it('applying remote rows does not trigger scheduleSync', async () => {
    files.set('ledger1', { version: 1, data: { ...empty(), entries: [entry({ id: 'R1' })], suppliers: [{ id: 'S9', name: 'Remote', updatedAt: 3, deviceId: 'phoneB', deleted: false }] } });
    currentEmail.mockResolvedValue(null); // no app-open sync
    await startSync();
    expect(_pendingSync()).toBe(false);
    expect((await syncNow()).status).toBe('ok');
    expect(await db.entries.get('R1')).toBeTruthy();
    expect(_pendingSync()).toBe(false);
    scheduleSync();
    expect(_pendingSync()).toBe(true);
  });

  it('runs on app open only when signed in, and on the online event', async () => {
    files.set('ledger1', { version: 1, data: empty() });
    currentEmail.mockResolvedValue(null);
    await startSync();
    expect(drive.readJson).not.toHaveBeenCalled();
    expect(getSyncState().status).toBe('authNeeded');
    stopSync();
    currentEmail.mockResolvedValue('a@b.com');
    await startSync();
    await vi.waitFor(() => expect(drive.readJson).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(getSyncState().running).toBe(false));
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(drive.readJson).toHaveBeenCalledTimes(2));
  });
});
