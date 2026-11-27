import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { setLanguage } from '../../i18n';
import { InOutLine } from './InOutLine';
import { ProfitBars } from './ProfitBars';
import { Donut } from './Donut';

beforeEach(() => setLanguage('en'));

const months = [
  { label: '2026-08', in: 900000, out: 700000, profit: 200000 },
  { label: '2026-09', in: 500000, out: 650000, profit: -150000 },
  { label: '2026-10', in: 950000, out: 741000, profit: 209000 },
];

test('ProfitBars marks only the negative month with data-sign="neg"', () => {
  const { container } = render(<ProfitBars data={months} />);
  const neg = container.querySelectorAll('rect[data-sign="neg"]');
  expect(neg).toHaveLength(1);
  expect(neg[0].textContent).toContain('2026-09');
  expect(container.querySelectorAll('rect[data-sign="pos"]')).toHaveLength(2);
  expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Profit/);
});

test('InOutLine is an img with a summarising label and both lines', () => {
  const { container } = render(<InOutLine data={months} />);
  expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/Money in .*money out/);
  expect(container.querySelector('path[stroke="#6FE3A0"]')).toBeTruthy();
  expect(container.querySelector('path[stroke="#FF8E8E"]')).toBeTruthy();
});

test('Donut slice arcs add up to the circumference within 1', () => {
  const { container } = render(
    <Donut centerLabel="Out" centerValue="€7,460" slices={[
      { label: 'Food', cents: 450000, color: '#6FE3A0' },
      { label: 'Drinks', cents: 296000, color: '#FF8E8E' },
      { label: 'Other', cents: 1, color: '#fff' },
    ]} />,
  );
  const arcs = [...container.querySelectorAll('circle[data-arc]')].map((c) => Number(c.getAttribute('data-arc')));
  expect(arcs).toHaveLength(3);
  expect(Math.abs(arcs.reduce((a, b) => a + b, 0) - 2 * Math.PI * 40)).toBeLessThanOrEqual(1);
  expect(screen.getByRole('img').getAttribute('aria-label')).toContain('Food');
});
