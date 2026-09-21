import { expect, test } from '@playwright/test';
import { at, automate, expectBalance, openDeposit, setUp, typeInto } from './deposit-maturity';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('is off by default and changes nothing', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await expect(page.getByLabel('Automate')).not.toBeChecked();
  await expect(page.getByTestId('maturity-principal')).toHaveCount(0);
  await page.clock.setSystemTime(at(s.matures));
  await page.goto('/net-worth/assets');
  await expect(page.getByRole('link', { name: /^BCA Deposito/ })).not.toContainText('Due');
  await openDeposit(page, s.depositName);
  await expect(page.getByTestId('deposit-proposal')).toHaveCount(0);
  await expectBalance(page, s.payoutName, '1.000.000');
});

test('keeps its settings across a reload, and a typed withholding', async ({ page }) => {
  const s = await setUp(page, 'IDR');
  await openDeposit(page, s.depositName);
  await automate(page, { choice: 'close', paid: 'monthly', exempt: false });
  await typeInto(page, 'Tax withheld %', '12,5');
  await page.getByLabel('Tax withheld %').press('Tab');
  await page.reload();
  await expect(page.getByLabel('Automate')).toBeChecked();
  await expect(page.getByTestId('maturity-close').getByLabel('Chosen')).toBeVisible();
  await expect(page.getByLabel('Interest paid')).toHaveValue('monthly');
  await expect(page.getByLabel('Term', { exact: true })).toHaveValue('3');
  await expect(page.getByLabel('Lands in')).toHaveValue(/.+/);
  await expect(page.getByLabel('Tax withheld %')).toHaveValue('12,5');
});
