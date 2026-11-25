import { expect, test } from '@playwright/test';
import { FUND, fundByMoney } from './fund-trade';
import { pickTradeCash } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

test('Buy a fund by amount: no NAV, no units, and the value grows by the amount', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  // The fund, fixed and named alone; a fund bought by money has no units row.
  await expect(page.getByTestId('trade-holding')).toHaveText(FUND);
  await expect(sheet.getByLabel('Units', { exact: true })).toHaveCount(0);
  // Nothing is chosen until an account has been used for this fund (owner, 25 Nov 2026).
  await expect(sheet.getByRole('button', { name: /^Payment method/ })).not.toContainText('BCA');
  await pickTradeCash(page, sheet, 'Payment method', 'BCA');
  await expect(sheet.getByRole('button', { name: /^Payment method/ })).toContainText('BCA');
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('500000');
  await expect(page.getByTestId('fund-units')).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'More options' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-card')).toContainText('1.552.000');
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 1.500.000');
  // History lists money moved only; the value typed is the hero's, its day under Held at.
  await expect(page.getByText('Last updated', { exact: true })).toBeVisible();
  await expect(page.getByText('Bought', { exact: true }).first()).toBeVisible();
  // The one "Value" on the page is the round button: no row of History says it.
  await expect(page.getByText('Value', { exact: true })).toHaveCount(1);
});

test('a fee typed in the details is put in with the amount: Money in grows by both', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Amount', { exact: true }).pressSequentially('500000');
  // Nothing is chosen for her until an account has been used for this holding (owner, 25 Nov 2026): picked once.
  await pickTradeCash(page, sheet, 'Payment method', 'BCA');
  await sheet.getByRole('button', { name: 'Add more details' }).click();
  // A buy's details: the Fee; Tax withheld is a sell's.
  await expect(sheet.getByLabel('Tax withheld', { exact: true })).toHaveCount(0);
  await sheet.getByLabel('Fee', { exact: true }).pressSequentially('5000');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  // 1.000.000 put in before, and 500.000 + 5.000 now.
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 1.505.000');
});

test('Sell half the value: half the money comes out, the rest is gain; never more than it is worth; All ends at zero', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Amount', { exact: true }).pressSequentially('500000');
  // Nothing is chosen for her until an account has been used for this holding (owner, 25 Nov 2026): picked once.
  await pickTradeCash(page, page.getByRole('dialog'), 'Payment method', 'BCA');
  await page.getByRole('button', { name: 'Record buy' }).click();

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const amount = sheet.getByLabel('Amount', { exact: true });
  await amount.pressSequentially('776000');
  // 776.000 of 1.552.000 takes 750.000 of the 1.500.000 put in.
  await expect(page.getByTestId('fund-gain')).toContainText('+Rp 26.000');

  await amount.fill('2000000');
  await expect(page.getByTestId('fund-worth')).toContainText('Rp 1.552.000');
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();

  await amount.fill('776000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-card')).toContainText('776.000');
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 750.000');

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const all = sheet.getByRole('button', { name: 'All', exact: true });
  await all.click();
  await expect(amount).toHaveValue('776.000');
  // Into the row and out again changes nothing: leaving it tidies the figure, and All stays on (fix round 1).
  await amount.focus();
  await amount.blur();
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 0');
});
