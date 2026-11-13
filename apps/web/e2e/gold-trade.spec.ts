import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { chooseGoal } from './add-transaction';
import { expectBalance } from './deposit-maturity';
import { GOLD, goldAtPrice } from './gold-trade';
import { addGoal } from './set-aside';
import { openTradeDetails, pickTradeCash } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('Buy gold bars: grams and the receipt’s total, and the holding gains both', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Buy' })).toBeVisible();
  // The holding is fixed and named alone, as Expense's Category row reads: no second line under it.
  const holding = page.getByTestId('trade-holding');
  await expect(holding).toHaveText(GOLD);
  // Paid with first, as Expense: the bank is chosen already.
  await expect(sheet.getByRole('button', { name: /^Paid with/ })).toContainText('BCA');
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await sheet.getByLabel('Grams', { exact: true }).fill('5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9850000');
  await expect(sheet.getByLabel('Total paid', { exact: true })).toHaveValue('9850000');
  // The code before the figure, as Expense's amount row writes it.
  await expect(sheet.getByText('IDR', { exact: true })).toBeVisible();
  // Nothing to work out on a buy.
  await expect(page.getByTestId('gold-gain')).toHaveCount(0);
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  const grid = page.getByTestId('asset-grid');
  await expect(grid).toContainText('17 g');
  await expect(grid).toContainText('32.350.000');
});

test('Sell gold bars: the gain against the average cost, no more grams than are held, and All ends at 0 g', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Sell' })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Received into/ })).toContainText('BCA');
  const grams = sheet.getByLabel('Grams', { exact: true });
  await grams.fill('2');
  await sheet.getByLabel('Received', { exact: true }).pressSequentially('3640000');
  // 2 g at the average 1.875.000 cost 3.750.000.
  await expect(page.getByTestId('gold-gain')).toContainText('−Rp 110.000');

  await grams.fill('13');
  await expect(sheet).toContainText('More than the 12 g held');
  await expect(page.getByRole('button', { name: 'Record sell' })).toBeDisabled();

  await sheet.getByRole('button', { name: 'All', exact: true }).click();
  await expect(grams).toHaveValue('12');
  await sheet.getByLabel('Received', { exact: true }).fill('24000000');
  await expect(page.getByTestId('gold-gain')).toContainText('+Rp 1.500.000');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('0 g');
});

test('Add more details opens a second box in the same sheet; a fee folded away is still recorded, on top of the total', async ({ page }) => {
  await addGoal(page, 'Hajj fund', '50000000');
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('button', { name: 'More options' })).toHaveCount(0);
  const fee = sheet.getByLabel('Fee', { exact: true });
  await expect(fee).toHaveCount(0);
  await sheet.getByLabel('Grams', { exact: true }).fill('5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9850000');

  const toggle = sheet.getByRole('button', { name: 'Add more details' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  // The same dialog, one more card: the goal and the Fee, empty in a word, never a sample figure. Tax withheld is a sell's.
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(fee).toHaveAttribute('placeholder', 'Fee');
  await expect(sheet.getByLabel('Tax withheld', { exact: true })).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: /^Goal/ })).toContainText('None');
  // A bank pays: no card, so no rows for points.
  await expect(sheet.getByRole('button', { name: 'Category for points' })).toHaveCount(0);
  // One currency on both sides: no rate to ask.
  await expect(sheet.getByLabel('Rate that day')).toHaveCount(0);
  // The first box stays first: Grams still holds what was typed, above the new box.
  await expect(sheet.getByLabel('Grams', { exact: true })).toHaveValue('5');
  await fee.pressSequentially('50000');
  await expect(fee).toHaveValue('50.000');

  // Folded away, the fee is kept, and the save still sends it.
  await sheet.getByRole('button', { name: 'Fewer details' }).click();
  await expect(fee).toHaveCount(0);
  await expect(sheet.getByRole('button', { name: 'Add more details' })).toBeVisible();
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  // The cost is the receipt's total and the fee together: 22.500.000 + 9.850.000 + 50.000.
  const grid = page.getByTestId('asset-grid');
  await expect(grid).toContainText('17 g');
  await expect(grid).toContainText('32.400.000');
  await expectBalance(page, 'BCA', '20.100.000'); // 30.000.000 − 9.900.000
});

test('a past purchase is recorded with no account moving: Paid with reads Past purchase', async ({ page }) => {
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9850000');
  await openTradeDetails(sheet);
  await sheet.getByLabel('Past purchase', { exact: true }).click();
  await expect(sheet.getByRole('button', { name: /^Paid with/ })).toContainText('Past purchase');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('17 g');
  await expectBalance(page, 'BCA', '30.000.000');
});

test('a sell from a goal takes its grams out of that goal', async ({ page }) => {
  await addGoal(page, 'Hajj fund', '50000000');
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  let sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9850000');
  await openTradeDetails(sheet);
  await chooseGoal(sheet, 'Hajj fund');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('2');
  await sheet.getByLabel('Received', { exact: true }).pressSequentially('3900000');
  await openTradeDetails(sheet);
  await chooseGoal(sheet, 'Hajj fund');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('15 g');

  // The 2 g came out of the goal: 3 g are left in it, so 4 g more from it are refused — 5 g would have covered them.
  await page.getByRole('button', { name: 'Sell', exact: true }).click();
  sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('4');
  await sheet.getByLabel('Received', { exact: true }).pressSequentially('7800000');
  await openTradeDetails(sheet);
  await chooseGoal(sheet, 'Hajj fund');
  await page.getByRole('button', { name: 'Record sell' }).click();
  await expect(sheet.getByText(/Hajj fund holds/)).toBeVisible();
});

test('Rate that day is asked only when the money account is in another currency, and the account pays at it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Dollar Saver', currency: 'USD', balance: '1000', rate: '16250' });
  await goldAtPrice(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Grams', { exact: true }).fill('5');
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially('9800000');
  await pickTradeCash(page, sheet, 'Paid with', 'BCA');
  await openTradeDetails(sheet);
  await expect(sheet.getByLabel('Rate that day')).toHaveCount(0);

  await pickTradeCash(page, sheet, 'Paid with', 'Dollar Saver');
  const rate = sheet.getByLabel('Rate that day');
  await expect(rate).toBeVisible();
  // Not saved until the rate is typed.
  await expect(page.getByRole('button', { name: 'Record buy' })).toBeDisabled();
  await rate.pressSequentially('16000');
  await expect(sheet).toContainText('Reads as 1 USD = 16.000 IDR');
  await page.getByRole('button', { name: 'Record buy' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('asset-grid')).toContainText('17 g');
  // Rp 9.800.000 at 16.000 a dollar is US$612,50 out of 1.000.
  await expectBalance(page, 'Dollar Saver', '387,50');

});
