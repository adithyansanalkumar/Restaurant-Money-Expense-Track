import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { getDeviceId } from './device';
import { listLive, put, seedDefaults, softDelete } from './repo';
import type { Category, Supplier } from '../domain/types';

beforeEach(async () => {
  vi.useRealTimers();
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('repo', () => {
  it('put stamps updatedAt and deviceId and is idempotent by id', async () => {
    const a = await put<Supplier>('suppliers', { id: 's1', name: 'Farm' });
    expect(a.deviceId).toBe(await getDeviceId());
    expect(a.updatedAt).toBeGreaterThan(0);
    expect(a.deleted).toBe(false);
    await put<Supplier>('suppliers', { id: 's1', name: 'Farm 2' });
    const all = await db.suppliers.toArray();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Farm 2');
    const b = await put<Supplier>('suppliers', { name: 'New' } as never);
    expect(b.id).toBeTruthy();
  });

  it('softDelete hides from listLive but row still exists with deleted=true and a newer updatedAt', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    await put<Supplier>('suppliers', { id: 's1', name: 'Farm' });
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    await softDelete('suppliers', 's1');
    vi.restoreAllMocks();
    expect(await listLive<Supplier>('suppliers')).toHaveLength(0);
    const row = await db.suppliers.get('s1');
    expect(row?.deleted).toBe(true);
    expect(row!.updatedAt).toBe(2000);
  });

  it('put is monotonic: a re-put with a clock behind the stored row still moves updatedAt forward', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5000);
    await put<Supplier>('suppliers', { id: 's1', name: 'Farm' });
    vi.spyOn(Date, 'now').mockReturnValue(3000); // clock went backwards
    const b = await put<Supplier>('suppliers', { id: 's1', name: 'Farm 2' });
    vi.restoreAllMocks();
    expect(b.updatedAt).toBe(5001);
    expect((await db.suppliers.get('s1'))!.updatedAt).toBe(5001);
  });

  it('put on a new row uses Date.now()', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(7000);
    const a = await put<Supplier>('suppliers', { id: 'n1', name: 'New' });
    vi.restoreAllMocks();
    expect(a.updatedAt).toBe(7000);
  });

  it('put and softDelete read+write inside one rw transaction over the table and meta', async () => {
    const seen: string[][] = [];
    const rec = (...a: any[]) => { const tx = a[a.length - 1]; seen.push([tx?.mode, ...[...(tx?.storeNames ?? [])].sort()]); };
    db.suppliers.hook('creating', rec);
    db.suppliers.hook('updating', rec);
    try {
      await put<Supplier>('suppliers', { id: 's1', name: 'Farm' });
      await put<Supplier>('suppliers', { id: 's1', name: 'Farm 2' });
      await softDelete('suppliers', 's1');
    } finally {
      db.suppliers.hook('creating').unsubscribe(rec);
      db.suppliers.hook('updating').unsubscribe(rec);
    }
    expect(seen).toEqual([['readwrite', 'meta', 'suppliers'], ['readwrite', 'meta', 'suppliers'], ['readwrite', 'meta', 'suppliers']]);
  });

  it('seedDefaults twice creates 14 expense categories and 5 income channels once', async () => {
    await seedDefaults();
    await seedDefaults();
    const cats = await listLive<Category>('categories');
    expect(cats.filter((c) => c.kind === 'expense')).toHaveLength(14);
    expect(cats.filter((c) => c.kind === 'income')).toHaveLength(5);
    expect(cats).toHaveLength(19);
    const c0 = await db.categories.get('cat:expense:0');
    expect(c0?.deviceId).toBe('seed');
    expect(c0?.updatedAt).toBe(0);
  });
});
