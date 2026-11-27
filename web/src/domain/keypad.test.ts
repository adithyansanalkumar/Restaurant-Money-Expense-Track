import { expect, test } from 'vitest';
import { sanitizeAmount } from './keypad';

test('digits pass through; empty stays empty', () => {
  expect(sanitizeAmount('184', ',')).toBe('184');
  expect(sanitizeAmount('', ',')).toBe('');
});
test('either separator is accepted and normalised to the locale one, once', () => {
  expect(sanitizeAmount('184,5', ',')).toBe('184,5');
  expect(sanitizeAmount('184.5', ',')).toBe('184,5');
  expect(sanitizeAmount('184,', ',')).toBe('184,');
  expect(sanitizeAmount('184,5,', ',')).toBe('184,5');
  expect(sanitizeAmount('1.2.3', '.')).toBe('1.23');
});
test('a leading separator gets a 0', () => {
  expect(sanitizeAmount(',5', ',')).toBe('0,5');
});
test('at most 2 decimals', () => {
  expect(sanitizeAmount('184,507', ',')).toBe('184,50');
});
test('no leading zeros', () => {
  expect(sanitizeAmount('05', '.')).toBe('5');
  expect(sanitizeAmount('00', '.')).toBe('0');
  expect(sanitizeAmount('0.0', '.')).toBe('0.0');
});
test('at most 9 integer digits', () => {
  expect(sanitizeAmount('1234567891', '.')).toBe('123456789');
});
test('anything else (spaces, minus, letters, currency) is dropped', () => {
  expect(sanitizeAmount(' 1 280,50 €', ',')).toBe('1280,50');
  expect(sanitizeAmount('-5', '.')).toBe('5');
  expect(sanitizeAmount('abc', '.')).toBe('');
});
