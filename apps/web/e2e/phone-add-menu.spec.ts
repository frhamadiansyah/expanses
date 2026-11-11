import { expect, type Page, test } from '@playwright/test';

/*
 * The tab bar's ＋: a plain tap opens the Add form exactly as before. On Cashflow, with Settings › Default's hold set to
 * Show the menu, press and hold opens a small menu of the other ways in. The hold is driven with touch pointer events,
 * the way a finger on a phone sends it.
 */
const plus = (page: Page) => page.getByRole('button', { name: 'Add a transaction' });
const menu = (page: Page) => page.getByRole('dialog', { name: 'Add' });
const touch = { pointerType: 'touch', isPrimary: true };

/** Settings › Default: holding ＋ on Cashflow shows the menu (One line is the default). */
async function chooseMenu(page: Page) {
  await page.goto('/settings/default');
  await page.getByRole('button', { name: 'Show the menu', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
}

async function open(page: Page, at = '/transactions') {
  await page.goto(at);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

async function hold(page: Page) {
  await expect(plus(page)).toHaveAttribute('data-hold', 'menu');
  await plus(page).dispatchEvent('pointerdown', touch);
  await page.waitForTimeout(600);
  await plus(page).dispatchEvent('pointerup', touch);
  await expect(menu(page)).toBeVisible();
}

test('a plain tap on ＋ still opens the Add form', async ({ page }) => {
  await open(page);
  await plus(page).click();
  await expect(page).toHaveURL(/\/transactions\/new$/);
  await expect(menu(page)).toHaveCount(0);
});

test('holding ＋ opens the menu with the four ways', async ({ page }) => {
  await chooseMenu(page);
  await open(page);
  const before = page.url();
  await hold(page);
  const ways = ['One line', 'Paste a list', 'Scan a receipt', 'Add transaction'];
  const rows = menu(page).getByRole('button', { name: /^(One line|Paste a list|Scan a receipt|Add transaction)$/ });
  await expect(rows).toHaveCount(ways.length);
  for (const [index, way] of ways.entries()) await expect(rows.nth(index)).toHaveAccessibleName(way);
  expect(page.url()).toBe(before);
  await page.screenshot({ path: test.info().outputPath('add-menu.png') });
});

test('each way goes where it says', async ({ page }) => {
  await chooseMenu(page);
  await test.step('One line', async () => {
    await open(page);
    await hold(page);
    await menu(page).getByRole('button', { name: 'One line', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions\/line$/);
    await expect(menu(page)).toHaveCount(0);
  });

  await test.step('Paste a list', async () => {
    await open(page);
    await hold(page);
    await menu(page).getByRole('button', { name: 'Paste a list', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions\/paste$/);
  });

  await test.step('Add transaction', async () => {
    await open(page);
    await hold(page);
    await menu(page).getByRole('button', { name: 'Add transaction', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions\/new$/);
  });

  await test.step('Scan a receipt: Cashflow, the scan started, and the address left clean', async () => {
    await open(page);
    await hold(page);
    await menu(page).getByRole('button', { name: 'Scan a receipt', exact: true }).click();
    await expect(page).toHaveURL(/\/transactions$/);
    expect(page.url()).not.toContain('scan=');
    // A browser has no camera: the scan the link started answers with the shell's own words.
    await expect(page.getByText('Not available here')).toBeVisible();
  });
});

test('a press shorter than the hold is a tap', async ({ page }) => {
  await chooseMenu(page);
  await open(page);
  await expect(plus(page)).toHaveAttribute('data-hold', 'menu');
  await plus(page).dispatchEvent('pointerdown', touch);
  await page.waitForTimeout(100);
  await plus(page).dispatchEvent('pointerup', touch);
  await plus(page).click();
  await expect(page).toHaveURL(/\/transactions\/new$/);
  await expect(menu(page)).toHaveCount(0);
});
