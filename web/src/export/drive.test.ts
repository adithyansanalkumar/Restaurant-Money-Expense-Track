import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db/db';

const drive = vi.hoisted(() => ({
  ensureFolder: vi.fn(async (name: string, parent?: string) => (parent ? `${name}@${parent}` : 'ownFolder')),
  uploadBlob: vi.fn(async (_n: string, _p: string, _b: Blob, _m: string) => ({ id: 'x', version: '1' })),
}));
vi.mock('../sync/drive', async (orig) => ({ ...(await orig<typeof import('../sync/drive')>()), ...drive }));
import { saveExportToDrive } from './drive';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  drive.ensureFolder.mockClear();
  drive.uploadBlob.mockClear();
});

describe('saveExportToDrive', () => {
  it('owner: Exports subfolder of the ledger folder, xlsx mime', async () => {
    await db.meta.put({ key: 'ledgerRef', value: { folderId: 'F1', fileId: 'L1' } });
    const blob = new Blob(['x']);
    await saveExportToDrive(blob, 'resto.xlsx');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Exports', 'F1');
    expect(drive.uploadBlob).toHaveBeenCalledWith('resto.xlsx', 'Exports@F1', blob, XLSX);
  });
  it('joined phone: Exports subfolder of its own folder', async () => {
    await db.meta.put({ key: 'ledgerRef', value: { fileId: 'L9', joined: true } });
    await saveExportToDrive(new Blob(['x']), 'r.xlsx');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Restaurant Accounts');
    expect(drive.ensureFolder).toHaveBeenCalledWith('Exports', 'ownFolder');
    expect(drive.uploadBlob.mock.calls[0][1]).toBe('Exports@ownFolder');
  });
});
