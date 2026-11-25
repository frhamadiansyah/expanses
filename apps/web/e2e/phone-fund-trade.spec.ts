import { expect, test } from '@playwright/test';
import { fillFigure } from './add-transaction';
import { fundByMoney } from './fund-trade';
import { pickTradeCash } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('phone: a fund bought by amount grows by it, then sold with All down to nothing', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await fillFigure(sheet, 'Amount', '500000');
  // No account is chosen for her until one has been used (owner, 25 Nov 2026): picked here once.
  await pickTradeCash(page, sheet, 'Payment method', 'BCA');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-card')).toContainText('1.552.000');

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await fillFigure(sheet, 'Amount', '4000000');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();
  const all = sheet.getByRole('button', { name: 'All', exact: true });
  await all.click();
  // The keypad opened on All's figure and closed with DONE writes it back tidied: still All (fix round 1).
  await sheet.getByLabel('Amount', { exact: true }).click();
  const keypad = page.getByTestId('keypad');
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toHaveCount(0);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('fund-gain')).toContainText('+Rp 52.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 0');
});
