/**
 * End-to-end UX checks against a running app.
 *
 * Needs the API on :8000 with a dataset (and families) built: `npm run dev` from
 * the repository root starts both. Uses the locally installed Microsoft Edge, so
 * no browser download is needed. Not part of CI, which has no dataset.
 *
 *   npx playwright test                      # UX tests on desktop, tablet and phone
 *   SCREENS=1 npx playwright test screens    # also write review screenshots to e2e/screens/
 */
import { defineConfig } from '@playwright/test';

const PHONE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: 'msedge',
    // Software WebGL so deck.gl renders the same on machines without a GPU.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 1024, height: 768 } } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: PHONE_UA },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
