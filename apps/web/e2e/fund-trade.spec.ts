import { expect, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('Buy a fund by amount: no NAV, no units, and the value grows by the amount', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(page.getByTestId('trade-holding')).toContainText(FUND);
  await expect(page.getByTestId('trade-holding')).toContainText('Worth Rp 1.052.000');
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('500000');
  await expect(page.getByTestId('fund-units')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'More options' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-card')).toContainText('1.552.000');
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 1.500.000');
});

test('Sell half the value: half the money comes out, the rest is gain; never more than it is worth; All ends at zero', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).pressSequentially('500000');
  await page.getByRole('button', { name: 'Record buy' }).click();

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const amount = sheet.getByLabel('Amount', { exact: true });
  await amount.pressSequentially('776000');
  // 776.000 of 1.552.000 takes 750.000 of the 1.500.000 put in.
  await expect(page.getByTestId('fund-gain')).toContainText('+Rp 26.000');

  await amount.fill('2000000');
  await expect(page.getByTestId('fund-worth')).toContainText('Rp 1.552.000');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();

  await amount.fill('776000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-card')).toContainText('776.000');
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 750.000');

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(amount).toHaveValue('776.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 0');
});
