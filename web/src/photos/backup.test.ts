import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';
import { reloadSettings, saveShared } from '../settings/store';

const drive = vi.hoisted(() => ({
  ensureFolder: vi.fn(async (name: string, parent?: string) => (parent ? `${name}@${parent}` : 'ownFolder')),
  uploadBlob: vi.fn(async (_n: string, _p: string, _b: Blob, _m: string) => ({ id: 'x', version: '1' })),
}));
vi.mock('../sync/drive', async (orig) => ({ ...(await orig<typeof import('../sync/drive')>()), ...drive }));
const auth = vi.hoisted(() => ({ email: 'adi@x.com' as string | null }));
vi.mock('../sync/auth', async (orig) => ({ ...(await orig<typeof import('../sync/auth')>()), currentEmail: async () => auth.email }));

import { Offline } from '../sync/auth';
import { backupPendingPhotos } from './backup';

const photo = (id: string, createdAt: number, backedUp = false) => db.photos.put({ id, blob: new Blob([id], { type: 'image/jpeg' }), createdAt, backedUp });

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await reloadSettings();
  auth.email = 'adi@x.com';
  drive.ensureFolder.mockClear();
  drive.uploadBlob.mockReset().mockResolvedValue({ id: 'x', version: '1' });
  await saveShared({ restaurantName: 'R', photoBackup: true });
  await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
});

describe('backupPendingPhotos', () => {
  it('uploads nothing when photoBackup is off', async () => {
    await saveShared({ photoBackup: false });
    await photo('p1', 1);
    expect(await backupPendingPhotos()).toBe(0);
    expect(drive.uploadBlob).not.toHaveBeenCalled();
  });

  it('uploads nothing when signed out', async () => {
    auth.email = null;
    await photo('p1', 1);
    expect(await backupPendingPhotos()).toBe(0);
    expect(drive.uploadBlob).not.toHaveBeenCalled();
  });

  it('owner: uploads each un-backed-up photo once to the ledger folder\'s Bills subfolder, then marks it', async () => {
    await photo('p1', 1); await photo('p2', 2); await photo('p3', 3, true);
    expect(await backupPendingPhotos()).toBe(2);
    expect(drive.ensureFolder).toHaveBeenCalledWith('Bills', 'F1');
    expect(drive.uploadBlob).toHaveBeenCalledTimes(2);
    const names = drive.uploadBlob.mock.calls.map((c) => c[0]).sort();
    expect(names).toEqual(['p1.jpg', 'p2.jpg']);
    expect(drive.uploadBlob.mock.calls[0][1]).toBe('Bills@F1');
    expect(drive.uploadBlob.mock.calls[0][3]).toBe('image/jpeg');
    expect((await db.photos.get('p1'))!.backedUp).toBe(true);
    expect(await backupPendingPhotos()).toBe(0); // nothing is uploaded twice
    expect(drive.uploadBlob).toHaveBeenCalledTimes(2);
  });

  it('marking a photo does not touch the synced rows (no restamp of shared settings)', async () => {
    const before = await db.settings.get('shared');
    await photo('p1', 1);
    await backupPendingPhotos();
    expect(await db.settings.get('shared')).toEqual(before);
  });

  it('joined phone: uses its own folder\'s Bills subfolder', async () => {
    await db.meta.put({ key: 'ledgerRef', value: { fileId: 'L9', joined: true } });
    await photo('p1', 1);
    expect(await backupPendingPhotos()).toBe(1);
    expect(drive.ensureFolder).toHaveBeenCalledWith('Restaurant Accounts');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Bills', 'ownFolder');
    expect(drive.uploadBlob.mock.calls[0][1]).toBe('Bills@ownFolder');
  });

  it('offline stops quietly: the count so far is returned and the rest stays pending', async () => {
    await photo('p1', 1); await photo('p2', 2);
    drive.uploadBlob.mockResolvedValueOnce({ id: 'x', version: '1' }).mockRejectedValueOnce(new Offline());
    expect(await backupPendingPhotos()).toBe(1);
    const left = (await db.photos.toArray()).filter((p) => !p.backedUp);
    expect(left).toHaveLength(1);
  });

  it('does nothing while adoptPending is set', async () => {
    await db.meta.put({ key: 'adoptPending', value: true });
    await photo('p1', 1);
    expect(await backupPendingPhotos()).toBe(0);
    expect(drive.ensureFolder).not.toHaveBeenCalled();
  });

  it('two overlapping calls upload each photo once', async () => {
    await photo('p1', 1);
    const [a, b] = await Promise.all([backupPendingPhotos(), backupPendingPhotos()]);
    expect(drive.uploadBlob).toHaveBeenCalledTimes(1);
    expect(a + b).toBeGreaterThanOrEqual(1);
  });
});

describe('setting changes during a run', () => {
  it('turning it on while a run (that saw it off) is in flight still backs up afterwards', async () => {
    await saveShared({ photoBackup: false });
    await photo('p1', 1);
    const first = backupPendingPhotos(); // reads the setting as off
    await saveShared({ photoBackup: true });
    const second = backupPendingPhotos(); // swallowed by the in-flight run: must trigger a rerun
    await Promise.all([first, second]);
    expect(drive.uploadBlob).toHaveBeenCalledTimes(1);
    expect((await db.photos.get('p1'))!.backedUp).toBe(true);
  });

  it('switching it off mid-run stops uploading the remaining photos', async () => {
    await photo('p1', 1); await photo('p2', 2); await photo('p3', 3);
    drive.uploadBlob.mockImplementationOnce(async () => {
      await saveShared({ photoBackup: false });
      return { id: 'x', version: '1' };
    });
    await backupPendingPhotos();
    expect(drive.uploadBlob).toHaveBeenCalledTimes(1);
    expect((await db.photos.toArray()).filter((p) => !p.backedUp)).toHaveLength(2);
  });
});
