import { describe, expect, test } from 'vitest';
import { parseAmount, formatMoney } from './money';
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CHANNELS } from './defaults';

describe('parseAmount', () => {
  test.each([
    ['184,50', 18450], ['184.50', 18450], ['1 280,00', 128000], ['1.280,50', 128050],
    ['1,280.50', 128050], ['0,5', 50], ['12', 1200], ['1,280', 128000], ['1 280', 128000],
    ['1 280,00', 128000], ['1 280,00', 128000],
  ])('parseAmount(%s)', (s, c) => expect(parseAmount(s)).toBe(c));

  test.each(['', 'abc', '-5', '1,2,3', '12.345.6', '1.2.3,50', '1,280.50,5'])(
    'parseAmount rejects %s', (s) => expect(parseAmount(s)).toBeNull());
});

test('formatMoney', () => {
  expect(formatMoney(234000, 'EUR', 'fr-FR', { sign: true }).replace(/\s/g, ' ')).toBe('+2 340,00 €');
  expect(formatMoney(-18650, 'EUR', 'en-GB', { sign: true })).toBe('−€186.50');
  expect(formatMoney(-18650, 'EUR', 'en-GB')).toBe('−€186.50');
});

test('defaults', () => {
  expect(DEFAULT_EXPENSE_CATEGORIES).toHaveLength(14);
  expect(DEFAULT_EXPENSE_CATEGORIES[0]).toBe('Vegetables & fruit');
  expect(DEFAULT_INCOME_CHANNELS).toEqual(['Dine-in', 'Takeaway', 'Delivery apps', 'Catering', 'Other']);
});
