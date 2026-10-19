import { expect, test } from '@playwright/test';
import { fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: a fund bought by amount grows by it, then sold with All down to nothing', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('500000');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-card')).toContainText('1.552.000');

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('4000000');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(page.getByTestId('fund-gain')).toContainText('+Rp 52.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 0');
});
