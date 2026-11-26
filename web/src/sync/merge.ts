import type { Base, Category, Entry, Payment, SharedSettings, Supplier } from '../domain/types';

export type Ledger = {
  schema: 1;
  entries: Entry[];
  payments: Payment[];
  suppliers: Supplier[];
  categories: Category[];
  settings: SharedSettings[];
};

export const LEDGER_TABLES = ['entries', 'payments', 'suppliers', 'categories', 'settings'] as const;
export type LedgerTable = (typeof LEDGER_TABLES)[number];

export const emptyLedger = (): Ledger => ({ schema: 1, entries: [], payments: [], suppliers: [], categories: [], settings: [] });

/** JSON with object keys sorted, so equal records always compare equal. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/**
 * True when `a` strictly beats `b`: higher updatedAt; on a tie the higher deviceId.
 * A full tie with different content (should not happen) is broken by content, so merge stays commutative.
 */
export function wins(a: Base, b: Base): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId;
  return canonical(a) > canonical(b);
}

function mergeTable<T extends Base>(a: T[], b: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of [...a, ...b]) {
    const cur = byId.get(row.id);
    if (!cur || wins(row, cur)) byId.set(row.id, row);
  }
  return [...byId.values()].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/** Per table, per id: the winning record (tombstones are kept). Commutative, idempotent, sorted by id. */
export function merge(a: Ledger, b: Ledger): Ledger {
  return {
    schema: 1,
    entries: mergeTable(a.entries, b.entries),
    payments: mergeTable(a.payments, b.payments),
    suppliers: mergeTable(a.suppliers, b.suppliers),
    categories: mergeTable(a.categories, b.categories),
    settings: mergeTable(a.settings, b.settings),
  };
}

export class LedgerFormatError extends Error {
  constructor(message: string) { super(message); this.name = 'LedgerFormatError'; }
}

/** Validates a downloaded ledger.json; throws LedgerFormatError rather than guess. */
export function parseLedger(data: unknown): Ledger {
  if (!data || typeof data !== 'object') throw new LedgerFormatError('ledger.json is not an object');
  const d = data as Record<string, unknown>;
  if (d.schema !== 1) throw new LedgerFormatError(`Unsupported ledger schema: ${String(d.schema)}`);
  const out = emptyLedger() as unknown as Record<LedgerTable, Base[]>;
  for (const t of LEDGER_TABLES) {
    const rows = d[t] ?? [];
    if (!Array.isArray(rows)) throw new LedgerFormatError(`ledger.json: ${t} is not a list`);
    for (const r of rows) {
      const ok = r && typeof r === 'object' && typeof r.id === 'string' && r.id !== ''
        && typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt)
        && typeof r.deviceId === 'string' && typeof r.deleted === 'boolean';
      if (!ok) throw new LedgerFormatError(`ledger.json: bad record in ${t}`);
    }
    out[t] = rows as Base[];
  }
  return out as unknown as Ledger;
}
