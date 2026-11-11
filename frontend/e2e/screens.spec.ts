/**
 * Review screenshots of the key states, written to e2e/screens/ (gitignored).
 * Only runs with SCREENS=1, so the regular e2e run stays fast.
 */
import { expect, test, type Page } from '@playwright/test';

test.skip(!process.env.SCREENS, 'set SCREENS=1 to write review screenshots');

const TOHOKU = 21169;

async function ready(page: Page, hash = '') {
  await page.goto(`/${hash}`);
  await expect(page.getByLabel('Timeline', { exact: true })).toBeVisible();
  await page.waitForTimeout(2500); // let tiles and the GPU layer settle
}

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `e2e/screens/${test.info().project.name}-${name}.png` });

test('default view', async ({ page }) => {
  await ready(page);
  await shot(page, '01-default');
});

test('filters open', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: '6+' }).click();
  await page.waitForTimeout(400); // popover entrance animation
  await shot(page, '02-filters');
});

test('date range popover', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: /Change date range/ }).click();
  await page.waitForTimeout(400);
  await shot(page, '03-dates');
});

for (const tab of ['details', 'family', 'forecast'] as const) {
  test(`event ${tab}`, async ({ page }) => {
    await ready(page, `#/explore?e=${TOHOKU}${tab === 'details' ? '' : `&tab=${tab}`}`);
    await page.waitForTimeout(1500);
    await shot(page, `04-event-${tab}`);
  });
}

test('playback window', async ({ page }) => {
  await ready(page, '#/explore?y=2000..2024&w=2010..2');
  await shot(page, '05-window');
});

test('help', async ({ page }) => {
  await ready(page);
  await page.getByRole('button', { name: 'Help and about' }).click();
  await page.waitForTimeout(400);
  await shot(page, '06-help');
});

test('simulator', async ({ page }) => {
  await page.goto('/#/simulate');
  await page.waitForTimeout(2500);
  await shot(page, '07-simulator');
});
