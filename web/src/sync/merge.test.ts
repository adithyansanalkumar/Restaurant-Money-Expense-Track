import { describe, expect, it } from 'vitest';
import { emptyLedger, merge, type Ledger } from './merge';
import type { Entry, Supplier } from '../domain/types';

const TABLES = ['entries', 'payments', 'suppliers', 'categories', 'settings'] as const;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 50 random records over a small id pool (so the two sides overlap), with deliberate updatedAt ties. */
function randomLedger(r: () => number): Ledger {
  const l = emptyLedger() as unknown as Record<string, Record<string, unknown>[]>;
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const table = TABLES[Math.floor(r() * TABLES.length)];
    const id = `${table}:${Math.floor(r() * 12)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    l[table].push({
      id, updatedAt: Math.floor(r() * 5), deviceId: r() < 0.5 ? 'A' : 'B', deleted: r() < 0.2,
      name: `n${Math.floor(r() * 3)}`, amountIncl: Math.floor(r() * 3) * 100,
    });
  }
  for (const t of TABLES) l[t].sort((x, y) => ((x.id as string) < (y.id as string) ? -1 : 1));
  return l as unknown as Ledger;
}

const base = { deviceId: 'A', deleted: false };
const entry = (p: Partial<Entry>): Entry => ({
  id: 'X', updatedAt: 1, ...base, kind: 'expense', date: '2026-11-01', amountIncl: 1000, categoryId: 'c', method: 'cash', createdBy: 'a', ...p,
});
const L = (p: Partial<Ledger>): Ledger => ({ ...emptyLedger(), ...p });

describe('merge', () => {
  it('is commutative and idempotent on random sets of 50 records', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const a = randomLedger(r);
      const b = randomLedger(r);
      const ab = merge(a, b);
      expect(ab).toEqual(merge(b, a));
      expect(merge(a, a)).toEqual(a);
      expect(merge(ab, ab)).toEqual(ab);
      expect(merge(ab, a)).toEqual(ab);
      expect(merge(merge(a, b), b)).toEqual(ab);
    }
  });

  it('edit at t=10 vs delete at t=12: deleted. Opposite timestamps: the edit wins', () => {
    const edit = entry({ updatedAt: 10, deviceId: 'phoneA', amountIncl: 2000 });
    const del = entry({ updatedAt: 12, deviceId: 'phoneB', deleted: true });
    for (const [a, b] of [[edit, del], [del, edit]]) {
      expect(merge(L({ entries: [a] }), L({ entries: [b] })).entries).toEqual([del]);
    }
    const edit2 = entry({ updatedAt: 12, deviceId: 'phoneA', amountIncl: 2000 });
    const del2 = entry({ updatedAt: 10, deviceId: 'phoneB', deleted: true });
    for (const [a, b] of [[edit2, del2], [del2, edit2]]) {
      expect(merge(L({ entries: [a] }), L({ entries: [b] })).entries).toEqual([edit2]);
    }
  });

  it('on an updatedAt tie the higher deviceId wins', () => {
    const a = entry({ updatedAt: 5, deviceId: 'aaa', amountIncl: 1 });
    const b = entry({ updatedAt: 5, deviceId: 'bbb', amountIncl: 2 });
    expect(merge(L({ entries: [a] }), L({ entries: [b] })).entries).toEqual([b]);
    expect(merge(L({ entries: [b] }), L({ entries: [a] })).entries).toEqual([b]);
  });

  it('keeps records that are only on one side, tombstones included, sorted by id', () => {
    const s1: Supplier = { id: 's2', name: 'B', updatedAt: 1, ...base };
    const s2: Supplier = { id: 's1', name: 'A', updatedAt: 1, ...base, deleted: true };
    const m = merge(L({ suppliers: [s1], entries: [entry({ id: 'e1' })] }), L({ suppliers: [s2] }));
    expect(m.suppliers.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(m.suppliers[0].deleted).toBe(true);
    expect(m.entries.map((e) => e.id)).toEqual(['e1']);
    expect(m.schema).toBe(1);
  });
});
