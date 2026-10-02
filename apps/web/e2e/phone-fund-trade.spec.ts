import { expect, test } from '@playwright/test';
import { fundAtNav } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: a fund bought by amount grows by its units, then sold with All down to zero', async ({ page }) => {
  await fundAtNav(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('1000000');
  await expect(page.getByTestId('fund-units')).toContainText('≈ 542,5137');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('1.898,7618');

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('4000000');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('fund-units')).toContainText('≈ 1.898,7618');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('0 units');
});

test('phone: More options opens the full form prefilled', async ({ page }) => {
  await fundAtNav(page);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).pressSequentially('500000');
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('dialog').getByLabel(/^Units, shares or grams/)).toHaveValue('271,2568');
});
