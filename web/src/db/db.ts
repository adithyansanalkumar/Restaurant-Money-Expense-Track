import Dexie, { type Table } from 'dexie';
import type { Category, Entry, Payment, SharedSettings, Supplier } from '../domain/types';

export interface PhotoRow { id: string; blob: Blob; createdAt: number; backedUp: boolean }
export interface MetaRow { key: string; value: unknown }

export class RestoDB extends Dexie {
  entries!: Table<Entry, string>;
  payments!: Table<Payment, string>;
  suppliers!: Table<Supplier, string>;
  categories!: Table<Category, string>;
  settings!: Table<SharedSettings, string>;
  photos!: Table<PhotoRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('resto');
    this.version(1).stores({
      entries: 'id, updatedAt, date, kind, supplierId',
      payments: 'id, updatedAt, date, entryId',
      suppliers: 'id, updatedAt',
      categories: 'id, updatedAt, kind',
      settings: 'id, updatedAt',
      photos: 'id, createdAt',
      meta: 'key',
    });
    this.on('ready', () => {
      try {
        void navigator.storage?.persist?.()?.catch?.(() => {});
      } catch {
        /* persistence is best-effort */
      }
    });
  }
}

export const db = new RestoDB();
