import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { todayIn } from './today';

/*
 * A phone held sideways on Cashflow: the wide-screen table full screen, with no tab bar and no sidebar. Every other
 * page turned sideways stays in the phone shell. Upright again, the list is back where it was left.
 */

const UPRIGHT = { width: 390, height: 844 };
const SIDEWAYS = { width: 844, height: 390 };

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** Eight invented purchases in one go, through Paste a list. */
async function eightPurchases(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'Bank Nusa', balance: '5000000' });
  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paste a list', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/paste/);
  await page
    .getByLabel('Purchases')
    .fill(['roti 15000', 'kopi 23000', 'bakso 31000', 'sate 42000', 'teh 7000', 'nasi goreng 28000', 'martabak 36000', 'parkir 4000'].join('\n'));
  await page.getByRole('button', { name: 'Review 8' }).click();
  await page.getByRole('button', { name: 'Save list' }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByTestId('transaction-row')).toHaveCount(8);
}

const previousMonth = (today: string) => {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
};

test('turning sideways on Cashflow shows the table full screen, and upright returns to the list where it was', async ({ page }) => {
  await eightPurchases(page);
  await page.evaluate(() => window.scrollTo(0, 300));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);

  await page.setViewportSize(SIDEWAYS);
  await expect(page.getByTestId('typing-row')).toBeVisible();
  expect(await page.getByTestId('table-row').count()).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.locator('aside')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Previous month' })).toBeVisible();
  await expect(page.getByTestId('sideways-bar')).toContainText('spent');
  await page.screenshot({ path: test.info().outputPath('sideways-table.png') });

  await page.setViewportSize(UPRIGHT);
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(before - 2);
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);
});

test('the month arrows step the month', async ({ page }) => {
  await eightPurchases(page);
  await page.setViewportSize(SIDEWAYS);
  await page.getByRole('button', { name: 'Previous month' }).click();
  const expected = previousMonth(await todayIn(page));
  await expect(page).toHaveURL(new RegExp(`month=${expected}`));
  await expect(page.getByTestId('sideways-bar')).toContainText(String(Number(expected.slice(0, 4))));
});

test('another page turned sideways stays in the phone shell', async ({ page }) => {
  await page.goto('/budget');
  await page.setViewportSize(SIDEWAYS);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);
});

test('Cashflow opened already sideways shows the table at once (Review Focus)', async ({ page }) => {
  await page.setViewportSize(SIDEWAYS);
  await page.goto('/transactions');
  await expect(page.getByTestId('typing-row')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await expect(page.locator('aside')).toHaveCount(0);
});
