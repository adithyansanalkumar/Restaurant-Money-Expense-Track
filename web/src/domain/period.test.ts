import { expect, test } from 'vitest';
import { periodRange, previousRange } from './period';

test('ranges containing 2026-11-25 (Wednesday)', () => {
  expect(periodRange('day', '2026-11-25', 1)).toEqual({ from: '2026-11-25', to: '2026-11-25' });
  expect(periodRange('week', '2026-11-25', 1)).toEqual({ from: '2026-11-23', to: '2026-11-29' });
  expect(periodRange('week', '2026-11-25', 0)).toEqual({ from: '2026-11-22', to: '2026-11-28' });
  expect(periodRange('month', '2026-11-25', 1)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  expect(periodRange('year', '2026-11-25', 1)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
});

test('previous ranges', () => {
  expect(previousRange('day', '2026-11-25', 1)).toEqual({ from: '2026-11-24', to: '2026-11-24' });
  expect(previousRange('week', '2026-11-25', 1)).toEqual({ from: '2026-11-16', to: '2026-11-22' });
  expect(previousRange('month', '2026-11-25', 1)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  expect(previousRange('month', '2026-01-10', 1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  expect(previousRange('year', '2026-11-25', 1)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
});
