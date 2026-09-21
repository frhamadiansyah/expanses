import { expect, type Page, test } from '@playwright/test';
import { addPurchase } from './add-transaction';
import { expectBalance } from './deposit-maturity';
import { addMoneyAccount, goalCard, jeniusWithTwoGoals } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

/** A USD stock owned before the app, through the inline Add asset form that exists today. */
async function addUsdStock(page: Page) {
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('stock');
  await page.getByLabel('Name', { exact: true }).pressSequentially('AAPL');
  await page.getByLabel('Currency').selectOption('USD');
  await page.getByLabel('Opening rate').pressSequentially('15800');
  await page.getByLabel('Bought on').fill('2025-03-08');
  await page.getByLabel('How much').pressSequentially('10');
  await page.getByLabel('Total cost (USD)').pressSequentially('1825');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /AAPL/ })).toBeVisible();
}

test('Buy & sell sells a USD holding into a rupiah account at exactly the rupiah that arrived', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '1000000');
  await addUsdStock(page);
  await page.goto('/net-worth/trades');
  await page.getByLabel('What happened').selectOption('sell');
  await page.getByLabel('Holding').selectOption({ label: 'AAPL' });
  await page.getByLabel('Money account').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Units, shares or grams').pressSequentially('3');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('642,90');
  await page.getByLabel('Charged in IDR').pressSequentially('10.447.125');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('trade-notice')).toContainText('Recorded');
  await expectBalance(page, 'BCA Tahapan', '11.447.125'); // 1.000.000 + exactly what arrived
});

test('the Buy / sell tab asks what the rupiah account was charged for a USD buy', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addUsdStock(page);
  await page.goto('/transactions');
  // The inline form gives a stock a lot size of 100, so the tab asks for lots; the figures are the same.
  await addPurchase(page, { what: 'AAPL', amount: '214,30', lots: '1', paidWith: 'BCA Tahapan (IDR)', charged: '3.482.375' });
  await expectBalance(page, 'BCA Tahapan', '46.517.625'); // 50.000.000 − 3.482.375
});

test('a USD buy from Jenius asks which goal paid for the rupiah that left, not the dollar cents', async ({ page }) => {
  await jeniusWithTwoGoals(page); // Jenius Rp 42.500.000, Rp 37.500.000 promised: Rp 5.000.000 free
  await addUsdStock(page);
  await page.goto('/net-worth/trades');
  await page.getByLabel('Money account').selectOption({ label: 'Jenius' });
  await page.getByLabel('Holding').selectOption({ label: 'AAPL' });
  await page.getByLabel('Units, shares or grams').pressSequentially('2');
  await page.getByLabel(/What it cost, before fees/).pressSequentially('418,50');
  await page.getByLabel('Charged in IDR').pressSequentially('6.800.000');
  // 6.800.000 − 5.000.000 free. Read off the dollar figure, 41.850 "rupiah" would have fitted and asked nothing.
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await page.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await page.getByRole('button', { name: 'No — borrowing from it' }).click();
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByTestId('trade-notice')).toContainText('Recorded');
  await page.goto('/goals');
  await expect(goalCard(page, 'Emergency fund').getByText(/short by Rp.1\.800\.000/i).first()).toBeVisible();
});

test('editing a sell into a rupiah account opens with what arrived, and saves without retyping it', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '1000000');
  await addUsdStock(page);
  await page.goto('/net-worth/trades');
  await page.getByLabel('What happened').selectOption('sell');
  await page.getByLabel('Holding').selectOption({ label: 'AAPL' });
  await page.getByLabel('Money account').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Units, shares or grams').pressSequentially('3');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('642,90');
  await page.getByLabel('Charged in IDR').pressSequentially('10.447.125');
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByTestId('trade-notice')).toContainText('Recorded');

  const sold = page.getByText(/Sell AAPL/).locator('xpath=ancestor::div[1]');
  await sold.getByRole('button', { name: 'Edit' }).click();
  // Read back from the sell's own transaction: the edit never starts from an empty figure.
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('10.447.125');
  await page.getByLabel('Units, shares or grams').fill('');
  await page.getByLabel('Units, shares or grams').pressSequentially('2');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByTestId('trade-notice')).toContainText('Recorded');
  await expectBalance(page, 'BCA Tahapan', '11.447.125'); // the same rupiah arrived: only the units changed
});

test('a USD sell whose fee took all of it records with nothing reaching the rupiah account, and its edit opens in the app’s number format', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '1000000');
  await addUsdStock(page);
  await page.goto('/net-worth/trades');
  await page.getByLabel('What happened').selectOption('sell');
  await page.getByLabel('Holding').selectOption({ label: 'AAPL' });
  await page.getByLabel('Money account').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Units, shares or grams').pressSequentially('1');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('1.500,00');
  await page.getByLabel('Fee (USD)').fill('');
  await page.getByLabel('Fee (USD)').pressSequentially('1.500,00');
  await expect(page.getByText(/Nothing reaches BCA Tahapan/)).toBeVisible();
  await page.getByRole('button', { name: 'Record' }).click();
  // The fee still posts in dollars, so the dollar lines need the day's rate: typed when this device holds none.
  const rate = page.getByLabel('Rate that day');
  const notice = page.getByTestId('trade-notice');
  await expect(rate.or(notice)).toBeVisible();
  if (await rate.isVisible()) {
    await rate.pressSequentially('16300');
    await page.getByRole('button', { name: 'Record' }).click();
  }
  await expect(notice).toContainText('Recorded');
  await expectBalance(page, 'BCA Tahapan', '1.000.000'); // nothing reached it

  await page.goto('/net-worth/trades');
  const sold = page.getByText(/Sell AAPL/).locator('xpath=ancestor::div[1]');
  await sold.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel(/Proceeds, before fees/)).toHaveValue('1.500,00');
  await expect(page.getByLabel('Fee (USD)')).toHaveValue('1.500,00');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('');
});
