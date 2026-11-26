import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { db } from '../db/db';
import { put, seedDefaults } from '../db/repo';
import { novemberEntries } from '../domain/__fixtures__/november';
import type { Entry } from '../domain/types';
import { exportExcel } from './workbook';

test('exportExcel builds an xlsx blob from the database', async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedDefaults();
  for (const e of novemberEntries) await put<Entry>('entries', e);
  const blob = await exportExcel('2026-11-01', '2026-11-30');
  expect(blob.size).toBeGreaterThan(500);
  const buf = await new Promise<ArrayBuffer>((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(blob.slice(0, 2)); });
  const head = new Uint8Array(buf);
  expect(String.fromCharCode(...head)).toBe('PK');
});
