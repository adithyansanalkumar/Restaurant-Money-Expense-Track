import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { put, softDelete } from '../db/repo';
import type { Entry, Supplier } from '../domain/types';
import type { Ledger } from './merge';

// ---- in-memory Drive, mocked at the module boundary ----
// A file: data + version, plus where it lives and when it was made (listing is oldest first).
// `hidden` simulates Drive listings that don't show another phone's new file yet.
type FakeFile = { data: unknown; version: number; parent?: string; created?: number; hidden?: boolean };
const files = new Map<string, FakeFile>();
const folders = new Map<string, { created: number; hidden?: boolean }>();
let clock = 1000;
let nextId = 1;
const readImpl = async (id: string) => {
  const f = files.get(id)!;
  return { data: structuredClone(f.data), version: String(f.version) };
};
const listImpl = (parent: string, n: number) =>
  [...files.entries()]
    .filter(([, f]) => (f.parent ?? 'folder1') === parent && !f.hidden)
    .sort(([a, x], [b, y]) => (x.created ?? 0) - (y.created ?? 0) || (a < b ? -1 : 1))
    .slice(0, n)
    .map(([id, f]) => ({ id, version: String(f.version) }));
const drive = {
  ensureFolder: vi.fn(async () => 'folder1'),
  findFolder: vi.fn(async () => {
    const all: [string, { created: number; hidden?: boolean }][] = [...folders.entries(), ['folder1', { created: 0 }]];
    return all.filter(([, f]) => !f.hidden).sort(([, x], [, y]) => x.created - y.created)[0]?.[0] ?? null;
  }),
  listFiles: vi.fn(async (_name: string, parent: string, n = 1) => listImpl(parent, n)),
  findFile: vi.fn(async (_name: string, parent: string) => listImpl(parent, 1)[0] ?? null),
  readJson: vi.fn(async (id: string) => readImpl(id)),
  getVersion: vi.fn(async (id: string) => String(files.get(id)!.version)),
  writeJson: vi.fn(async (id: string | null, name: string, parent: string, data: unknown) => writeImpl(id, name, parent, data)),
};
async function writeImpl(id: string | null, _name: string, parent: string, data: unknown) {
  let fid = id;
  if (!fid) { do fid = `ledger${nextId++}`; while (files.has(fid)); }
  const prev = files.get(fid);
  const version = (prev?.version ?? 0) + 1;
  files.set(fid, { ...prev, parent: prev?.parent ?? parent, created: prev?.created ?? clock++, data: structuredClone(data), version });
  return { id: fid, version: String(version) };
}
vi.mock('./drive', () => ({
  ensureFolder: (...a: unknown[]) => (drive.ensureFolder as any)(...a),
  findFolder: (...a: unknown[]) => (drive.findFolder as any)(...a),
  listFiles: (...a: unknown[]) => (drive.listFiles as any)(...a),
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
import { _pendingSync, _retryDelay, getSyncState, scheduleSync, startSync, stopSync, syncNow } from './sync';

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
  folders.clear();
  clock = 1000;
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
    expect((await db.meta.get('ledgerRef'))?.value).toMatchObject({ folderId: 'folder1', fileId: 'ledger1' });
  });

  it('creates ledger.json in "Restaurant Accounts" when none exists, then reuses the stored ref', async () => {
    await put<Supplier>('suppliers', { id: 'L1', name: 'Local' });
    expect((await syncNow()).status).toBe('ok');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Restaurant Accounts');
    expect(drive.writeJson.mock.calls[0].slice(0, 3)).toEqual([null, 'ledger.json', 'folder1']);
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'folder1', fileId: 'ledger1', createdHere: true });
    drive.ensureFolder.mockClear(); drive.findFile.mockClear();
    await put<Supplier>('suppliers', { id: 'L2', name: 'Local 2' });
    expect((await syncNow()).status).toBe('ok');
    expect(drive.ensureFolder).not.toHaveBeenCalled();
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

describe('two phones creating the ledger at the same time', () => {
  const theirs = () => ({ ...empty(), suppliers: [{ id: 'B1', name: 'Theirs', updatedAt: 1, deviceId: 'phoneB', deleted: false }] });

  it('after creating ledger.json, an older one made concurrently wins: switch to it and merge our rows in', async () => {
    await put<Supplier>('suppliers', { id: 'A1', name: 'Ours' });
    // phone B created its ledger first, but the listing didn't show it when we looked
    files.set('ledgerB', { data: theirs(), version: 1, parent: 'folder1', created: 1, hidden: true });
    drive.writeJson.mockImplementationOnce(async (id, name, parent, data) => {
      const r = await writeImpl(id, name, parent, data);
      files.get('ledgerB')!.hidden = false; // visible by the time we re-list after creating ours
      return r;
    });
    const r = await syncNow();
    expect(drive.writeJson.mock.calls[0][0]).toBeNull(); // we did create one
    expect(r.status).toBe('ok');
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'folder1', fileId: 'ledgerB' });
    expect((files.get('ledgerB')!.data as Ledger).suppliers.map((x) => x.id)).toEqual(['A1', 'B1']);
    expect(await db.suppliers.get('B1')).toBeTruthy();
  });

  it('a ref created here is re-checked each sync; both phones end on the oldest file with all rows', async () => {
    // phone A (us): created ledgerA; phone B's older ledgerB was invisible then
    await put<Supplier>('suppliers', { id: 'A1', name: 'Ours' });
    files.set('ledgerB', { data: theirs(), version: 1, parent: 'folder1', created: 1, hidden: true });
    expect((await syncNow()).status).toBe('ok');
    const refA = (await db.meta.get('ledgerRef'))?.value as { fileId: string; createdHere?: boolean };
    expect(refA.fileId).not.toBe('ledgerB');
    expect(refA.createdHere).toBe(true);
    // later B's file shows up in listings
    files.get('ledgerB')!.hidden = false;
    expect((await syncNow()).status).toBe('ok');
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'folder1', fileId: 'ledgerB' });
    expect((files.get('ledgerB')!.data as Ledger).suppliers.map((x) => x.id)).toEqual(['A1', 'B1']);
    // phone B (fresh device DB, its own ref to ledgerB, created there) stays put and gets A's rows
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'folder1', fileId: 'ledgerB', createdHere: true } });
    expect((await syncNow()).status).toBe('ok');
    expect(((await db.meta.get('ledgerRef'))?.value as { fileId: string }).fileId).toBe('ledgerB');
    expect((await db.suppliers.toArray()).map((x) => x.id)).toEqual(['A1', 'B1']);
  });

  it('a ref created here switches to an older "Restaurant Accounts" folder that has a ledger', async () => {
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'folder1', fileId: 'ledgerA', createdHere: true } });
    files.set('ledgerA', { data: empty(), version: 1, parent: 'folder1', created: 5 });
    folders.set('folderB', { created: -1 });
    files.set('ledgerB', { data: theirs(), version: 1, parent: 'folderB', created: 1 });
    await put<Supplier>('suppliers', { id: 'A1', name: 'Ours' });
    expect((await syncNow()).status).toBe('ok');
    expect((await db.meta.get('ledgerRef'))?.value).toEqual({ folderId: 'folderB', fileId: 'ledgerB' });
    expect((files.get('ledgerB')!.data as Ledger).suppliers.map((x) => x.id)).toEqual(['A1', 'B1']);
  });

  it('a ref that was not created here (joined / found) is not re-checked', async () => {
    files.set('ledger1', { data: empty(), version: 1, parent: 'folder1', created: 5 });
    files.set('older', { data: theirs(), version: 1, parent: 'folder1', created: 1 });
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'folder1', fileId: 'ledger1' } });
    expect((await syncNow()).status).toBe('ok');
    expect(((await db.meta.get('ledgerRef'))?.value as { fileId: string }).fileId).toBe('ledger1');
  });
});

describe('retries', () => {
  it('after offline/error, retries with backoff 30 s, 2 min, 10 min (cap) until a sync succeeds', async () => {
    files.set('ledger1', { version: 1, data: empty() });
    currentEmail.mockResolvedValue(null);
    await startSync();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    getAccessToken.mockRejectedValue(new Offline());
    expect((await syncNow()).status).toBe('offline');
    expect(_retryDelay()).toBe(30_000);
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(_retryDelay()).toBe(120_000));
    getAccessToken.mockRejectedValue(new Error('boom'));
    vi.advanceTimersByTime(120_000);
    await vi.waitFor(() => expect(_retryDelay()).toBe(600_000));
    vi.advanceTimersByTime(600_000);
    await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalledTimes(4));
    await vi.waitFor(() => expect(_retryDelay()).toBe(600_000));
    getAccessToken.mockReset().mockResolvedValue('TOK');
    vi.advanceTimersByTime(600_000);
    await vi.waitFor(() => expect(getSyncState().status).toBe('ok'));
    expect(_retryDelay()).toBeNull();
  });

  it('authNeeded does not retry', async () => {
    currentEmail.mockResolvedValue(null);
    await startSync();
    getAccessToken.mockRejectedValue(new AuthNeeded());
    expect((await syncNow()).status).toBe('authNeeded');
    expect(_retryDelay()).toBeNull();
  });

  it('coming back to the app (visibilitychange -> visible) schedules a sync when signed in', async () => {
    currentEmail.mockResolvedValue(null);
    await startSync();
    const vis = (v: string) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
    vis('visible');
    await new Promise((r) => setTimeout(r, 20));
    expect(_pendingSync()).toBe(false);
    currentEmail.mockResolvedValue('a@b.com');
    vis('hidden');
    await new Promise((r) => setTimeout(r, 20));
    expect(_pendingSync()).toBe(false);
    vis('visible');
    await vi.waitFor(() => expect(_pendingSync()).toBe(true));
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
