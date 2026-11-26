import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    ...devices['iPhone 13'],
    // iPhone 13 would use WebKit; only Chromium is installed here, so keep its viewport/UA but run Chromium.
    defaultBrowserType: 'chromium',
    viewport: { width: 390, height: 844 },
    acceptDownloads: true,
    locale: 'en-GB',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
