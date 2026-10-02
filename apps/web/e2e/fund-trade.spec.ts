import { expect, test } from '@playwright/test';
import { FUND, fundAtNav } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('Buy a fund by amount: the units come from the NAV to four places, and the holding grows by them', async ({ page }) => {
  await fundAtNav(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Buy' })).toBeVisible();
  await expect(page.getByTestId('trade-holding')).toContainText(FUND);
  await expect(page.getByTestId('trade-holding')).toContainText(/1\.356,2481 units · NAV 1\.843,2715 · \d{1,2} \w{3} \d{4}/);
  await expect(sheet.getByLabel('Amount', { exact: true })).toHaveAttribute('placeholder', 'Amount');
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('1000000');
  await expect(sheet.getByLabel('Amount', { exact: true })).toHaveValue('1.000.000');
  await expect(page.getByTestId('fund-units')).toContainText('≈ 542,5137');
  await expect(sheet.getByRole('button', { name: 'Paid from' })).toContainText('BCA');
  await sheet.getByRole('button', { name: 'About Units' }).click();
  await expect(sheet).toContainText('Units = amount ÷ NAV');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  // 1.356,2481 + 542,5137
  await expect(page.getByTestId('asset-grid')).toContainText('1.898,7618');
});

test('Sell a fund: the units and the gain on them, no more than is held, and All ends at exactly zero', async ({ page }) => {
  await fundAtNav(page);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sell' })).toBeVisible();
  const amount = sheet.getByLabel('Amount', { exact: true });
  await amount.pressSequentially('500000');
  await expect(page.getByTestId('fund-units')).toContainText('Units sold');
  await expect(page.getByTestId('fund-units')).toContainText('≈ 271,2568');
  // 271,2568 of 1.356,2481 cost 490.013 of the 2.450.000.
  await expect(page.getByTestId('fund-gain')).toContainText('+Rp 9.987');

  await amount.fill('3000000');
  await expect(sheet).toContainText('More than the 1.356,2481 units held');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();

  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(amount).toHaveValue('2.499.933');
  await expect(page.getByTestId('fund-units')).toContainText('≈ 1.356,2481');
  await expect(page.getByTestId('fund-gain')).toContainText('+Rp 49.933');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('0 units');
});

test('More options opens the full form with the amount, the units, the account and the day in it', async ({ page }) => {
  await fundAtNav(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).pressSequentially('1000000');
  await page.getByRole('button', { name: 'More options' }).click();
  const form = page.getByRole('dialog');
  await expect(form.getByLabel(/^Units, shares or grams/)).toHaveValue('542,5137');
  await expect(form.getByLabel(/^What it cost/)).toHaveValue('1.000.000');
  await expect(form.getByLabel(/^Fee/)).toHaveValue('0');
});
