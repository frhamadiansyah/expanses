import { expect, type Page, test } from '@playwright/test';
import { seedReport } from './debt-plan';
import { digits } from './debts-page';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const names = (page: Page) => page.getByTestId('all-debts-row').evaluateAll((els) => els.map((el) => el.getAttribute('data-name')));

test('all debts: chips, the sort kept on the device, and the one paid off', async ({ page }) => {
  await seedReport(page);
  await page.getByTestId('plan-row-all-debts').click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/debts$/);
  const chips = page.getByRole('radiogroup', { name: 'Show' });
  await expect(chips.getByRole('radio', { name: 'All 3' })).toBeVisible();
  await expect(chips.getByRole('radio', { name: 'Active 2' })).toBeVisible();
  await expect(chips.getByRole('radio', { name: 'Late 0' })).toBeVisible();
  await expect(chips.getByRole('radio', { name: 'Paid off 1' })).toBeVisible();
  await expect.poll(() => names(page)).toEqual(['BCA Visa', 'Kredit', 'Bank kecil']);

  await chips.getByRole('radio', { name: 'Paid off 1' }).click();
  await expect.poll(() => names(page)).toEqual(['Bank kecil']);
  await expect(page.getByTestId('all-debts-row')).toContainText('Paid off');
  await expect(page.getByTestId('all-debts-row')).toContainText('Oct 2026');

  await chips.getByRole('radio', { name: 'All 3' }).click();
  await page.getByRole('button', { name: 'Sort: Most left' }).click();
  await page.getByRole('menuitemradio', { name: 'Name' }).click();
  await expect.poll(() => names(page)).toEqual(['BCA Visa', 'Kredit', 'Bank kecil']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sort: Name' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('report: a period’s borrowed, repaid, interest and left, and paid against due by month', async ({ page }) => {
  await seedReport(page);
  const left = await page.getByTestId('plan-left').innerText();
  expect(digits(left)).toBe(11_263_145);
  await page.getByTestId('plan-row-report').click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/report/);
  const periods = page.getByRole('radiogroup', { name: 'Period' });
  await periods.getByRole('radio', { name: 'This month' }).click();
  await expect(page.getByTestId('report-borrowed')).toContainText('Rp 0');
  await expect(page.getByTestId('report-repaid')).toContainText('Rp 951.155');
  await expect(page.getByTestId('report-interest')).toContainText('Rp 120.000');
  await expect(page.getByTestId('report-left')).toContainText(left);

  await periods.getByRole('radio', { name: 'All' }).click();
  await expect(page.getByTestId('report-borrowed')).toContainText('Rp 12.714.300');
  await expect(page.getByTestId('report-repaid')).toContainText('Rp 1.451.155');
  const borrowed = digits(await page.getByTestId('report-borrowed').innerText());
  const repaid = digits(await page.getByTestId('report-repaid').innerText());
  expect(borrowed - repaid).toBe(digits(left));
  await expect(page.getByTestId('report-month').filter({ hasText: 'November' })).toContainText('so far');
  await expect(page.getByTestId('report-month').filter({ hasText: 'October' })).toContainText('Nothing due');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
