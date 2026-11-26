import type { Table } from 'dexie';
import { db } from './db';
import { getDeviceId } from './device';
import type { Base, Category } from '../domain/types';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CHANNELS } from '../domain/defaults';

export type SyncedTable = 'entries' | 'payments' | 'suppliers' | 'categories' | 'settings';

function tbl(name: SyncedTable): Table<Base & Record<string, unknown>, string> {
  return db[name] as unknown as Table<Base & Record<string, unknown>, string>;
}

export async function put<T extends Base>(
  table: SyncedTable,
  obj: Omit<T, 'updatedAt' | 'deviceId' | 'deleted' | 'id'> & Partial<Base>,
): Promise<T> {
  const id = obj.id ?? crypto.randomUUID();
  const deviceId = await getDeviceId();
  const existing = obj.id ? await tbl(table).get(id) : undefined;
  const row = {
    ...obj,
    id,
    // monotonic: never stamp a row older than (or equal to) what is already stored
    updatedAt: existing ? Math.max(Date.now(), existing.updatedAt + 1) : Date.now(),
    deviceId,
    deleted: obj.deleted ?? false,
  } as unknown as T;
  await tbl(table).put(row as never);
  return row;
}

export async function softDelete(table: SyncedTable, id: string): Promise<void> {
  const t = tbl(table);
  const row = await t.get(id);
  if (!row) return;
  await t.put({
    ...row,
    deleted: true,
    updatedAt: Math.max(Date.now(), row.updatedAt + 1),
    deviceId: await getDeviceId(),
  });
}

export async function listLive<T extends Base>(table: SyncedTable, filter?: (row: T) => boolean): Promise<T[]> {
  const rows = (await tbl(table).toArray()) as unknown as T[];
  return rows.filter((r) => !r.deleted && (!filter || filter(r)));
}

export async function seedDefaults(): Promise<void> {
  const mk = (kind: Category['kind'], names: string[]): Category[] =>
    names.map((name, i) => ({
      id: `cat:${kind}:${i}`, name, kind, archived: false, updatedAt: 0, deviceId: 'seed', deleted: false,
    }));
  const all = [...mk('expense', DEFAULT_EXPENSE_CATEGORIES), ...mk('income', DEFAULT_INCOME_CHANNELS)];
  await db.transaction('rw', db.categories, async () => {
    const existing = new Set(await db.categories.bulkGet(all.map((c) => c.id)).then((r) => r.filter(Boolean).map((c) => c!.id)));
    await db.categories.bulkAdd(all.filter((c) => !existing.has(c.id)));
  });
}
