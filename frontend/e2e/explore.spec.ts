/**
 * UX checks for the Explore view against the running app and sample dataset.
 * Run on desktop, tablet and phone viewports (see playwright.config.ts).
 */
import { expect, test, type Page } from '@playwright/test';

const TOHOKU = 21169;
const isPhone = () => test.info().project.name === 'phone';

async function open(page: Page, hash = '') {
  await page.goto(`/${hash}`);
  await expect(page.getByLabel('Timeline', { exact: true })).toBeVisible();
}

/** The headline count: the inspector column, or the phone's peek bar. */
async function shownCount(page: Page): Promise<number> {
  const text = isPhone()
    ? await page.getByRole('button', { name: /earthquakes/ }).first().innerText()
    : await page.getByText('Earthquakes shown', { exact: true }).locator('xpath=following-sibling::div[1]').innerText();
  return Number(text.replace(/[^\d]/g, ''));
}

/** The count once the summary has loaded. */
async function loadedCount(page: Page): Promise<number> {
  await expect.poll(() => shownCount(page)).toBeGreaterThan(0);
  return shownCount(page);
}

test('time is controlled in exactly one place', async ({ page }) => {
  await open(page);
  // Two handles for the range, and no other year inputs or sliders anywhere.
  await expect(page.getByRole('slider', { name: 'Start year' })).toHaveCount(1);
  await expect(page.getByRole('slider', { name: 'End year' })).toHaveCount(1);
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('button', { name: /Change date range/ }).click();
  await page.getByRole('button', { name: '2000+' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Period 2000 – 2024/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove filter: 2000 – 2024' })).toBeVisible();
  await expect(page).toHaveURL(/y=2000\.\.2024/);
});

test('filters show as chips that can be removed', async ({ page }) => {
  await open(page);
  const before = await loadedCount(page);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByRole('button', { name: '7+' }).click();
  await page.keyboard.press('Escape');
  const chip = page.getByRole('button', { name: 'Remove filter: M 7.0+' });
  await expect(chip).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filters, 1 active' })).toBeVisible();
  await expect.poll(() => shownCount(page)).toBeLessThan(before);
  await chip.click();
  await expect(chip).toHaveCount(0);
  await expect.poll(() => shownCount(page)).toBe(before);
});

test('hiding aftershocks shrinks the catalog', async ({ page }) => {
  await open(page);
  const before = await loadedCount(page);
  await page.getByRole('button', { name: /^Filters/ }).click();
  await page.getByLabel(/Hide foreshocks and aftershocks/).check();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Remove filter: No aftershocks' })).toBeVisible();
  await expect.poll(() => shownCount(page)).toBeLessThan(before * 0.8);
  await expect(page).toHaveURL(/dc=1/);
});

test('a deep link opens the event on its family tab, and Back deselects', async ({ page }) => {
  await open(page);
  await page.goto(`/#/explore?e=${TOHOKU}&tab=family`);
  await expect(page.getByText('2011 Great Tohoku Earthquake, Japan').first()).toBeVisible();
  await expect(page.getByRole('tab', { name: /Family/ })).toHaveAttribute('data-state', 'active');
  await expect(page.getByRole('tree', { name: 'Family tree' })).toBeVisible();

  // Pick the family's first event (the M7.3 foreshock) from the tree: a new history entry.
  await page.getByRole('tree').getByTitle('Foreshock, generation 0').click();
  await expect(page).not.toHaveURL(new RegExp(`e=${TOHOKU}(&|$)`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`e=${TOHOKU}`));
  await expect(page.getByText('M 9.1 (mww)')).toBeVisible();
});

test('Escape returns to the overview', async ({ page }) => {
  test.skip(isPhone(), 'the phone sheet closes on Escape instead');
  await open(page, `#/explore?e=${TOHOKU}`);
  await expect(page.getByText('M 9.1 (mww)')).toBeVisible();
  await page.locator('body').press('Escape');
  await expect(page.getByText('Earthquakes shown', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/e=/);
});

test('play opens a window and moves through time', async ({ page }) => {
  await open(page, '#/explore?y=2000..2024');
  await page.getByRole('button', { name: 'Play through time' }).click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Pause' }).click();
  const period = await page.getByRole('button', { name: /^Period/ }).getAttribute('aria-label');
  expect(period).not.toContain('2000 – 2024');
  await expect(page.getByRole('button', { name: /Show all years|All/ }).first()).toBeVisible();
  await expect(page).toHaveURL(/w=/);
});

test('the layout never scrolls sideways', async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const views = page.getByRole('navigation', { name: 'App views' }).getByRole('link');
  await expect(views).toHaveCount(2);
  for (const link of await views.all()) await expect(link).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole('button', { name: 'Help and about' })).toBeInViewport({ ratio: 1 });
});

test('the simulator keeps working from the shared header', async ({ page }) => {
  await open(page);
  await page.getByRole('navigation', { name: 'App views' }).getByRole('link').nth(1).click();
  await expect(page).toHaveURL(/#\/simulate/);
  await expect(page.getByRole('button', { name: /Run simulation/ })).toBeVisible();
  await page.getByRole('navigation', { name: 'App views' }).getByRole('link').first().click();
  await expect(page.getByLabel('Timeline', { exact: true })).toBeVisible();
});
