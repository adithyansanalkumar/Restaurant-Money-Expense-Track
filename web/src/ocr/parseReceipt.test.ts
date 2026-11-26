import { describe, expect, it } from 'vitest';
import { matchSupplier, parseReceipt } from './parseReceipt';
import type { Supplier } from '../domain/types';

const files = import.meta.glob('./fixtures/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const fx = (n: string) => files[`./fixtures/${n}`];
const sup = (id: string, name: string): Supplier => ({ id, name, updatedAt: 0, deviceId: 'd', deleted: false });
const suppliers = [sup('s1', 'Metro Cash & Carry'), sup('s2', 'Boucherie Martin')];

describe('parseReceipt', () => {
  it('reads the French Metro fixture', () => {
    const r = parseReceipt(fx('metro-fr.txt'), 'fra', suppliers);
    expect(r).toMatchObject({ incl: 18450, excl: 15380, tax: 3070, date: '2026-11-25', shop: 'METRO CASH & CARRY', supplierId: 's1' });
  });
  it('handles O-for-0 noise, SOUS-TOTAL and NET À PAYER', () => {
    const r = parseReceipt(fx('boucherie-fr.txt'), 'fra', suppliers);
    expect(r).toMatchObject({ incl: 8683, excl: 8230, tax: 453, date: '2026-11-25', supplierId: 's2' });
  });
  it('no total gives undefined incl', () => {
    const r = parseReceipt(fx('nototal-fr.txt'), 'fra', suppliers);
    expect(r.incl).toBeUndefined();
    expect(r.date).toBe('2026-11-25');
    expect(r.shop).toBe('Primeur du Sud');
    expect(r.supplierId).toBeUndefined();
  });
  it('English GRAND TOTAL', () => {
    expect(parseReceipt(fx('grand-total-en.txt'), 'eng', []).incl).toBe(5240);
  });
  it('English subtotal + VAT + TOTAL', () => {
    expect(parseReceipt(fx('subtotal-en.txt'), 'eng', [])).toMatchObject({ incl: 8400, excl: 7000, tax: 1400, date: '2026-11-25' });
  });
  it('US date when the second number is above 12; tax+total gives excl', () => {
    const r = parseReceipt(fx('us-date-en.txt'), 'eng', []);
    expect(r.date).toBe('2026-11-25');
    expect(r).toMatchObject({ incl: 4374, tax: 324, excl: 4050 });
  });
  it('computes the missing third value', () => {
    expect(parseReceipt('Total HT 100,00\nTVA 20,00\n', 'fra', [])).toMatchObject({ excl: 10000, tax: 2000, incl: 12000 });
    expect(parseReceipt('TOTAL TTC 120,00\nTVA 20,00\n', 'fra', [])).toMatchObject({ excl: 10000 });
    expect(parseReceipt('TOTAL TTC 120,00\nTotal HT 100,00\n', 'fra', [])).toMatchObject({ tax: 2000 });
  });
  it('most specific keyword wins, bottom-most wins ties', () => {
    expect(parseReceipt('TOTAL 10,00\nTOTAL TTC 20,00\nTOTAL 30,00\n', 'fra', []).incl).toBe(2000);
    expect(parseReceipt('TOTAL 10,00\nTOTAL 30,00\n', 'fra', []).incl).toBe(3000);
  });
  it.each([
    ['25/11/2026', 'fra', '2026-11-25'],
    ['25.11.26', 'fra', '2026-11-25'],
    ['2026-11-25', 'fra', '2026-11-25'],
    ['11/25/2026', 'eng', '2026-11-25'],
    ['03/04/2026', 'fra', '2026-04-03'],
  ] as const)('date %s (%s)', (txt, lang, iso) => {
    expect(parseReceipt(`Shop\n${txt}\n`, lang, []).date).toBe(iso);
  });
});

describe('matchSupplier', () => {
  it('ignores case, accents, punctuation, spaces and matches prefixes', () => {
    expect(matchSupplier('METRO CASH & CARRY', suppliers)?.id).toBe('s1');
    expect(matchSupplier('  metro   cash carry ', suppliers)?.id).toBe('s1');
    expect(matchSupplier('METRO', suppliers)?.id).toBe('s1');
    expect(matchSupplier('Métro Cash & Carry Paris 12', suppliers)?.id).toBe('s1');
    expect(matchSupplier('Primeur', suppliers)).toBeUndefined();
  });
});
