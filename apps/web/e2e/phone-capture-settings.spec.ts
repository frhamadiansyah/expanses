import { expect, type Page, test } from '@playwright/test';

/*
 * Settings → Capture, top to bottom: what to capture, the sources, the ways to capture (each a page of its own) and
 * the one Waiting row. The sentences that used to sit under the rows are behind ⓘ.
 */

async function settle(page: Page) {
  await expect(page.getByRole('heading', { name: 'Capture' }).first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // The shell opens Shortcuts and the iCloud link; a browser tab cannot, so the calls are recorded instead.
  await page.addInitScript(() => {
    const opened: string[] = [];
    (window as unknown as { __opened: string[] }).__opened = opened;
    window.open = ((url?: string | URL) => {
      opened.push(String(url));
      return null;
    }) as typeof window.open;
  });
  await page.goto('/settings/capture');
  await settle(page);
});

test('What to capture is a picker row that keeps its answer', async ({ page }) => {
  const scope = page.getByLabel('What to capture', { exact: true });
  await expect(scope).toHaveValue('everything');
  await expect(page.getByRole('button', { name: 'Everything' })).toHaveCount(0);

  // The sentence is behind the ⓘ, not under the row.
  const sentence = page.getByText('“Expenses only” skips money in');
  await expect(sentence).toHaveCount(0);
  await page.getByRole('button', { name: 'About What to capture' }).click();
  await expect(sentence).toBeVisible();

  await scope.selectOption('expenses-only');
  await expect(scope).toHaveValue('expenses-only');
  await page.reload();
  await settle(page);
  await expect(page.getByLabel('What to capture', { exact: true })).toHaveValue('expenses-only');
});

test('the page holds the guides behind rows, not on it', async ({ page }) => {
  await expect(page.getByText('Show the steps')).toHaveCount(0);
  await expect(page.getByText('What each source has learned')).toHaveCount(0);
  await expect(page.getByText('Nothing captured yet.')).toBeVisible();
  for (const way of ['Notifications', 'Screen scanner', 'Scan a receipt']) {
    await expect(page.getByRole('link', { name: way, exact: true })).toBeVisible();
  }
});

test('Notifications opens its steps, the iOS note and Open Shortcuts', async ({ page }) => {
  await page.getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/capture\/ways\/notifications$/);
  await expect(page.getByText('A payment notification becomes a draft')).toBeVisible();
  await expect(page.getByText('Needs iOS 27 or later')).toBeVisible();
  await expect(page.getByText('Open Shortcuts and start a new shortcut')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Screen scanner' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Shortcuts' }).click();
  expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['shortcuts://']);
});

test('Screen scanner opens its steps with both buttons', async ({ page }) => {
  await page.getByRole('link', { name: 'Screen scanner', exact: true }).click();
  await expect(page.getByText('A screenshot of a payment screen is read')).toBeVisible();
  await expect(page.getByText('Back-tap on any payment screen')).toBeVisible();
  await expect(page.getByText('Needs iOS 27 or later')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add Screen scanner' }).click();
  await page.getByRole('button', { name: 'Open Shortcuts' }).click();
  const opened = await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened);
  expect(opened).toHaveLength(2);
  expect(opened[0]).toMatch(/^https:\/\/www\.icloud\.com\/shortcuts\//);
  expect(opened[1]).toBe('shortcuts://');
});

test('Scan a receipt opens its steps and the scan button, and back returns to Capture', async ({ page }) => {
  await page.getByRole('link', { name: 'Scan a receipt', exact: true }).click();
  await expect(page.getByText('Photograph the receipt: flat, in the light')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan a receipt now' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open Shortcuts' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Capture', exact: true }).first().click();
  await expect(page).toHaveURL(/\/settings\/capture$/);
});

test('Waiting is one row with the count; Could not be opened shows only above zero', async ({ page }) => {
  const waiting = page.getByTestId('capture-waiting');
  await expect(waiting).toContainText('0 · Check now');
  await expect(page.getByText('Could not be opened')).toHaveCount(0);

  // The last check's line is behind the ⓘ.
  await expect(page.getByText('Last check:')).toHaveCount(0);
  await page.getByRole('button', { name: 'About Waiting' }).click();
  await expect(page.getByText('Last check: Not checked since the app opened.')).toBeVisible();

  await waiting.getByRole('button', { name: /^Waiting/ }).click();
  await expect(page.getByText(/Last check: .*nothing waiting/)).toBeVisible();
});
