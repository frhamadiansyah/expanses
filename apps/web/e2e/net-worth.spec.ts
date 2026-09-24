import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { openNewAsset } from './add-asset';
import { forgetRates } from './pockets';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** The label the old inline form used went with it; the kind decides what the picker asks for now. */
async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await openAccount(page, { subtype: type, name, balance: amount });
}

async function addGold(page: Page) {
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

/**
 * The Dashboard and this page were one subject drawn twice: the figure and the year behind it, what the month has
 * done, what the cards owe, what waits to be refreshed, the balance sheet under it and the ratios beside it. They are
 * one page now, and this is the list that says nothing was dropped on the way — every heading the two screens had.
 */
test('the two pages are one, and neither one lost a block', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '10000000');

  // The home route hands over, so an old link, a bookmark and the PWA's own start page all land here.
  await page.goto('/');
  await expect(page).toHaveURL(/\/net-worth$/);

  // What the Dashboard had.
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
  await expect(page.getByRole('heading', { name: 'Last 6 months' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'This month' })).toBeVisible();
  const month = page.locator('section').filter({ hasText: 'This month' });
  await expect(month.getByText('Spent')).toBeVisible();
  await expect(month.getByText('Income')).toBeVisible();
  const owed = page.locator('section').filter({ hasText: 'Credit cards owed' });
  await expect(owed.getByText('BCA KrisFlyer')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();

  // What the Overview had.
  await expect(page.getByRole('radiogroup', { name: 'Net worth sections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Balance sheet' })).toBeVisible();
  await expect(page.getByText(/Net worth =/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Financial health' })).toBeVisible();
});

test('shows net worth, the balance sheet and both sides of it', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '10000000');

  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
  await expect(page.getByText('Cash & equivalents').first()).toBeVisible();
  await expect(page.getByText('Due within a year').first()).toBeVisible();
  await expect(page.getByText(/Net worth =/)).toBeVisible();
});

test('says it does not know the cash-flow ratios until there are transactions', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth');
  await expect(page.getByText('Financial health')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Savings ratio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Surplus' })).toBeVisible();
  await expect(page.getByText('Not enough data').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Debt to assets' })).toBeVisible();
});

test('switches the ratios between the rolling year and a calendar year', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth');
  // The period switch is the kit's segmented control: a radio group, so the chosen one says `aria-checked`.
  await page.getByRole('radio', { name: 'Last 12 months' }).click();
  await expect(page.getByRole('radio', { name: 'Last 12 months' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: '2026', exact: true }).click();
  await expect(page.getByRole('radio', { name: '2026', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('moves net worth by the price difference only', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/net-worth');
  // The past purchase came from Opening Balances, so the bank balance stayed put and gold was added at cost.
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');

  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Update prices' }).click();
  await page.getByLabel(/Antam gold bars/).fill('1900000');
  await page.getByRole('button', { name: 'Save prices' }).click();
  // 10 g at Rp 1.900.000 on the assets list first, so a failure points at the right step.
  await expect(page.getByText(/19\.000\.000/).first()).toBeVisible();

  await page.goto('/net-worth');
  // 10 g at Rp 1.900.000 is Rp 19.000.000, against Rp 18.600.000 paid: only the Rp 400.000 difference moves.
  await expect(page.getByTestId('net-worth')).toContainText('69.000.000');
});

/**
 * The five section tabs are the app's main navigation, and a desktop is its highest tier: middle click and
 * "open link in new tab" have to work on them. Only a real `<a href>` gives a browser that — a radio button
 * that calls `navigate` looks identical and answers none of it — so the href is what is asserted.
 */
test('every net-worth section tab is a real link, so it can be opened in a new tab', async ({ page }) => {
  await page.goto('/net-worth');
  const tabs = page.getByRole('radiogroup', { name: 'Net worth sections' }).getByRole('radio');
  await expect(tabs).toHaveCount(4);
  const hrefs = await tabs.evaluateAll((nodes) => nodes.map((node) => [node.tagName, node.getAttribute('href')]));
  expect(hrefs).toEqual([
    ['A', '/net-worth'],
    ['A', '/net-worth/assets'],
    ['A', '/net-worth/trades'],
    ['A', '/net-worth/loans'],
  ]);
  await expect(tabs).toHaveText(['Overview', 'Assets', 'Buy & sell', 'Debts']);

  // Still a segmented control: clicking one selects it and takes the page with it, exactly as before.
  await page.getByRole('radio', { name: 'Debts' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);
  await expect(page.getByRole('radio', { name: 'Debts' })).toHaveAttribute('aria-checked', 'true');
});

/**
 * Assets and Debts carry a `+` in the title row; Overview and Trades carry none. A row that is as tall as its
 * corners made the section row sit 8 px lower on the two that have one — so moving between sections moved the
 * tabs, and everything under them. The bar is a corner's height whatever it holds.
 */
test('the section row sits at the same height on all four sections', async ({ page }) => {
  const tops: number[] = [];
  for (const path of ['/net-worth', '/net-worth/assets', '/net-worth/trades', '/net-worth/loans']) {
    await page.goto(path);
    const tabs = page.getByRole('radiogroup', { name: 'Net worth sections' });
    await expect(tabs).toBeVisible();
    tops.push(Math.round((await tabs.boundingBox())!.y));
  }
  expect(new Set(tops).size, `the row moved between sections: ${tops.join(', ')}`).toBe(1);
});

test('an empty account in a currency with no rate does not stop net worth: zero needs no rate', async ({ page }) => {
  // Offline: no rate can be fetched, and none was ever typed for USD — nor is one needed for an empty account.
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'Rupiah Saver', balance: '50000000' });
  await openAccount(page, { subtype: 'bank', name: 'Dollar Saver', currency: 'USD' });

  await page.goto('/');
  await expect(page.getByTestId('net-worth')).toContainText('50.000.000');
  await expect(page.getByTestId('net-worth')).not.toContainText('rate yet');

  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('50.000.000');
  await expect(page.getByTestId('ratios-missing')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Debt to assets' })).toBeVisible();
});

test('a currency with no rate stops net worth, the balance sheet and the ratios, and is named — never counted as 0', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'Rupiah Saver', balance: '50000000' });
  await openAccount(page, { subtype: 'bank', name: 'Dollar Saver', currency: 'USD', balance: '1000', rate: '16250' });
  // $1.000 held, and then no USD rate anywhere on the device.
  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));

  await page.goto('/');
  // Before, the dashboard printed Rp 50.000.000 as the net worth, the USD account silently at 0.
  await expect(page.getByTestId('net-worth')).toContainText('No USD rate yet');
  await expect(page.getByTestId('net-worth')).not.toContainText('50.000.000');

  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('No USD rate yet');
  await expect(page.getByTestId('net-worth')).not.toContainText('50.000.000');
  // The balance sheet and the ratios read the same rows, with USD at 0: they name the rate instead of a figure.
  await expect(page.getByTestId('balance-sheet-missing')).toContainText('No USD rate yet');
  await expect(page.getByText(/Net worth =/)).toHaveCount(0);
  await expect(page.getByTestId('ratios-missing')).toContainText('No USD rate yet, so the ratios cannot be worked out.');
  await expect(page.getByRole('heading', { name: 'Debt to assets' })).toHaveCount(0);
});
