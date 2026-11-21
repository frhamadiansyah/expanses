import { expect, type Page, test } from '@playwright/test';
import { addPurchase, chooseInvestment, chooseTradeMoney, openBuyOrSell, saveButton } from './add-transaction';
import { expectBalance } from './deposit-maturity';
import { addHoldingFlow } from './securities';
import { addMoneyAccount, goalCard, jeniusWithTwoGoals } from './set-aside';
import { openTradeDetails, openTradeForm, openTradeRow, pickTradeCash, recordTrade, tradeForm } from './trades';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

/** A USD stock owned before the app, bought through the ticker finder's own by-hand door. */
async function addUsdStock(page: Page) {
  await addHoldingFlow(page, {
    search: 'AAPL',
    nameIt: { ticker: 'AAPL', name: 'Apple', market: 'NASDAQ', currency: 'USD' },
    broker: { new: 'Stockbit' },
    quantity: '10',
    price: '182,50',
    paidFrom: 'Owned before this app',
    date: '2025-03-08',
    rate: '15800',
  });
  await page.getByRole('button', { name: 'Add holding' }).click();
  await expect(page.getByRole('heading', { name: 'AAPL' })).toBeVisible();
}

test('a USD holding’s Sell sells into a rupiah account at exactly the rupiah that arrived', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '1000000');
  await addUsdStock(page);
  await openTradeForm(page, 'sell', 'AAPL');
  await pickTradeCash(page, tradeForm(page), 'Received into', 'BCA Tahapan');
  await page.getByLabel('Shares', { exact: true }).pressSequentially('3');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('642,90');
  await page.getByLabel('Charged in IDR').pressSequentially('10.447.125');
  await recordTrade(page);
  await expectBalance(page, 'BCA Tahapan', '11.447.125'); // 1.000.000 + exactly what arrived
});

test('the Buy / sell tab asks what the rupiah account was charged for a USD buy', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '50000000');
  await addUsdStock(page);
  await page.goto('/transactions');
  // A hand-named US stock carries no lot size, so the tab asks for shares: 100 of them, as a lot of an IDX
  // stock would have been. The money is what the tab must get right, and it is the same as before.
  await addPurchase(page, { what: 'AAPL · Stockbit', amount: '214,30', units: '100', paidWith: 'BCA Tahapan (IDR)', charged: '3.482.375' });
  await expectBalance(page, 'BCA Tahapan', '46.517.625'); // 50.000.000 − 3.482.375
});

test('a USD buy from Jenius asks which goal paid for the rupiah that left, not the dollar cents', async ({ page }) => {
  await jeniusWithTwoGoals(page); // Jenius Rp 42.500.000, Rp 37.500.000 promised: Rp 5.000.000 free
  await addUsdStock(page);
  await openTradeForm(page, 'buy', 'AAPL');
  await pickTradeCash(page, tradeForm(page), 'Payment method', 'Jenius');
  await page.getByLabel('Shares', { exact: true }).pressSequentially('2');
  await page.getByLabel(/What it cost, before fees/).pressSequentially('418,50');
  await page.getByLabel('Charged in IDR').pressSequentially('6.800.000');
  // 6.800.000 − 5.000.000 free. Read off the dollar figure, 41.850 "rupiah" would have fitted and asked nothing.
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await page.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await page.getByRole('button', { name: 'No — borrowing from it' }).click();
  await recordTrade(page);
  await page.goto('/goals');
  await expect((await goalCard(page, 'Emergency fund')).getByText(/short by Rp.1\.800\.000/i).first()).toBeVisible();
});

// I5: only TradeForm's save (above) was guarded — the Buy / sell tab's own `recordTrade` call used to be able to
// drop the set-aside answer with nothing catching it, on desktop or phone, across six different specs. Same
// figures as the Jenius test above, through the Add Transaction card instead of the net worth screen.
test('the Buy / sell tab also asks which goal paid for the rupiah that left, on a USD buy', async ({ page }) => {
  await jeniusWithTwoGoals(page); // Jenius Rp 42.500.000, Rp 37.500.000 promised: Rp 5.000.000 free
  await addUsdStock(page);
  const form = await openBuyOrSell(page);
  await chooseInvestment(form, 'AAPL · Stockbit');
  await chooseTradeMoney(form, 'Jenius (IDR)');
  await form.getByLabel(/^What it cost, before fees/).fill('418,50');
  await form.getByLabel('Shares').fill('100'); // no lot size on a hand-named US stock: 100 shares, as before
  await form.getByLabel(/^Charged in /).pressSequentially('6.800.000');
  // 6.800.000 − 5.000.000 free. Read off the dollar figure, 41.850 "rupiah" would have fitted and asked nothing.
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await page.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await page.getByRole('button', { name: 'No — borrowing from it' }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/goals');
  await expect((await goalCard(page, 'Emergency fund')).getByText(/short by Rp.1\.800\.000/i).first()).toBeVisible();
});

test('editing a sell into a rupiah account opens with what arrived, and saves without retyping it', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '1000000');
  await addUsdStock(page);
  await openTradeForm(page, 'sell', 'AAPL');
  await pickTradeCash(page, tradeForm(page), 'Received into', 'BCA Tahapan');
  await page.getByLabel('Shares', { exact: true }).pressSequentially('3');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('642,90');
  await page.getByLabel('Charged in IDR').pressSequentially('10.447.125');
  await recordTrade(page);

  // The sell's line on Income opens its holding, and Edit under the line's ⋮ opens the full form on it.
  const sold = await openTradeRow(page, /Sold AAPL/, /Sold/);
  await sold.getByRole('button', { name: 'Edit', exact: true }).click();
  // Read back from the sell's own transaction: the edit never starts from an empty figure.
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('10.447.125');
  await page.getByLabel('Shares', { exact: true }).fill('');
  await page.getByLabel('Shares', { exact: true }).pressSequentially('2');
  await recordTrade(page, 'Save changes');
  await expectBalance(page, 'BCA Tahapan', '11.447.125'); // the same rupiah arrived: only the units changed
});

test('a USD sell whose fee took all of it records with nothing reaching the rupiah account, and its edit opens in the app’s number format', async ({ page }) => {
  await addMoneyAccount(page, 'BCA Tahapan', 'bank', '1000000');
  await addUsdStock(page);
  await openTradeForm(page, 'sell', 'AAPL');
  await pickTradeCash(page, tradeForm(page), 'Received into', 'BCA Tahapan');
  await page.getByLabel('Shares', { exact: true }).pressSequentially('1');
  await page.getByLabel(/Proceeds, before fees/).pressSequentially('1.500,00');
  // The fee waits under Add more details.
  await openTradeDetails(tradeForm(page));
  await page.getByLabel('Fee (USD)').fill('');
  await page.getByLabel('Fee (USD)').pressSequentially('1.500,00');
  await expect(page.getByText(/Nothing reaches BCA Tahapan/)).toBeVisible();
  const form = tradeForm(page);
  await form.getByRole('button', { name: 'Record', exact: true }).click();
  // The fee still posts in dollars, so the dollar lines need the day's rate: typed when this device holds none.
  // Saved, the sheet closes; asked for a rate, it stays open with the row in it.
  const rate = page.getByLabel('Rate that day');
  await expect(async () => {
    expect((await rate.isVisible()) || (await form.count()) === 0).toBe(true);
  }).toPass();
  if (await rate.isVisible()) {
    await rate.pressSequentially('16300');
    await form.getByRole('button', { name: 'Record', exact: true }).click();
  }
  await expect(form).toHaveCount(0);
  await expectBalance(page, 'BCA Tahapan', '1.000.000'); // nothing reached it

  const sold = await openTradeRow(page, /Sold AAPL/, /Sold/);
  await sold.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByLabel(/Proceeds, before fees/)).toHaveValue('1.500,00');
  await expect(page.getByLabel('Fee (USD)')).toHaveValue('1.500,00');
  await expect(page.getByLabel('Charged in IDR')).toHaveValue('');
});
