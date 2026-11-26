import { expect, test } from 'vitest';
import { pressKey } from './keypad';

test('separator appends once, normalised to the decimal separator', () => {
  expect(pressKey('184', ',', ',')).toBe('184,');
  expect(pressKey('184,', ',', ',')).toBe('184,');
  expect(pressKey('184', '.', ',')).toBe('184,');
  expect(pressKey('0', '.', '.')).toBe('0.');
});
test('at most 2 decimals', () => {
  expect(pressKey('184,5', '0', ',')).toBe('184,50');
  expect(pressKey('184,50', '7', ',')).toBe('184,50');
});
test('no leading zeros', () => {
  expect(pressKey('0', '5', '.')).toBe('5');
  expect(pressKey('0', '0', '.')).toBe('0');
  expect(pressKey('0.', '0', '.')).toBe('0.0');
});
test('at most 9 integer digits', () => {
  expect(pressKey('123456789', '1', '.')).toBe('123456789');
  expect(pressKey('123456789', '.', '.')).toBe('123456789.');
});
test('backspace', () => {
  expect(pressKey('0', '⌫', '.')).toBe('0');
  expect(pressKey('5', '⌫', '.')).toBe('0');
  expect(pressKey('18,5', '⌫', ',')).toBe('18,');
});
