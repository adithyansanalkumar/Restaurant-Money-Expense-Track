import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const SHOTS = 'e2e/screenshots';
const norm = (s: string | null) => (s ?? '').replace(/[  ]/g, ' ').replace(/−/g, '-');

test('first run, add an expense, see it on Home, export to Excel', async ({ page }) => {
  mkdirSync(SHOTS, { recursive: true });

  // Google / worker must never be contacted (fonts may be attempted; they are blocked too).
  const attempted: string[] = [];
  const blocked = /(^|\.)(google\.com|googleapis\.com|gstatic\.com|workers\.dev)$/;
  await page.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (blocked.test(host)) {
      attempted.push(host);
      return route.abort();
    }
    return route.continue();
  });
  // Chromium has no share sheet with files here; make sure the download path runs.
  await page.addInitScript(() => {
    try { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); } catch { /* ignore */ }
    try { Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true }); } catch { /* ignore */ }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Not now' }).click();

  // Setup (France is the default)
  await page.getByLabel('Restaurant name').fill('Chez Test');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Home
  await expect(page.getByText('Today out')).toBeVisible();
  await page.getByRole('link', { name: 'Add' }).click();

  // Keypad 1 8 4 , 5 0
  for (const k of ['1', '8', '4', ',', '5', '0']) await page.getByRole('button', { name: k, exact: true }).click();
  await expect(page.getByTestId('amount')).toContainText('184,50');

  // Create a supplier
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByLabel('Supplier name').fill('Metro');
  await page.getByRole('button', { name: 'Save expense' }).click();

  // Home shows -184,50 EUR in today out
  await expect(page.getByText('Today out')).toBeVisible();
  await expect.poll(async () => norm(await page.locator('body').innerText())).toMatch(/-184,50 €/);

  // Bills tab (no camera needed to view it)
  await page.getByRole('link', { name: 'Bills' }).click();
  await expect(page.getByRole('heading', { name: 'Bills' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${SHOTS}/bills.png` });

  // BillCheck view: feed a picture to the file input (no camera needed); best effort, OCR may not finish offline
  await page.getByTestId('bill-input').setInputFiles('public/icons/icon-512.png');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/billcheck.png` });
  await page.getByRole('button', { name: 'Close' }).click();

  // Settings screenshot
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByText('Restaurant', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/settings.png`, fullPage: true });

  // Reports -> export
  await page.getByRole('link', { name: 'Reports' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export to Excel' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.xlsx$/);

  expect(attempted.filter((h) => !/^fonts\.(googleapis|gstatic)\.com$/.test(h))).toEqual([]);
});
