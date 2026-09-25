import { expect, type Page, test } from '@playwright/test';
import { openAccount, openLoan } from './accounts';
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
 * The Dashboard and this page were one subject drawn twice: the figure and the year behind it, what waits to be
 * refreshed, the balance sheet under it and the ratios beside it. They are one page now, and this is the list that
 * says nothing was dropped on the way — every heading that is still this page's to say.
 *
 * The month's own spending and income and what the cards owe are not on it any more, and this says so: the Cashflow
 * screen answers the first two questions and the Cards screen the third, and a figure drawn on two screens is a
 * figure that can disagree with itself.
 */
test('the two pages are one, and what is left of them is all here', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '10000000');

  // The home route hands over, so an old link, a bookmark and the PWA's own start page all land here.
  await page.goto('/');
  await expect(page).toHaveURL(/\/net-worth$/);

  // What the Dashboard had.
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
  // Both of these are the Cashflow screen's and the Cards screen's subject now, and are on neither this page nor
  // the figure that repeats them.
  await expect(page.getByRole('heading', { name: 'This month' })).toHaveCount(0);
  await expect(page.getByText('Credit cards owed')).toHaveCount(0);

  // What waits is a screen of its own behind a corner glyph, and the glyph is not this page's heading either: the
  // page is about a figure, and the corner carries the count rather than the list.
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Needs attention' })).toBeVisible();

  // What the Overview had, with the ratios one tap away in the corner and the three sections behind the `…` beside it.
  await expect(page.getByRole('button', { name: 'More' })).toBeVisible();
  // The sheet is headed by its two sides and nothing else: "Balance sheet" and the line under it saying how it was
  // valued both said what "Assets" and "Liabilities" say with a figure beside them.
  await expect(page.getByRole('heading', { name: 'Balance sheet' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Liabilities' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Financial health' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Financial health' }).click();
  await expect(page).toHaveURL(/\/net-worth\/health$/);
  await expect(page.getByRole('heading', { name: 'Financial health' })).toBeVisible();
});

test('shows net worth, the balance sheet and both sides of it', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '10000000');

  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
  await expect(page.getByText('Cash & equivalents').first()).toBeVisible();
  // The debts are one group a side, drawn by kind rather than by when each one falls due — and the kind is the drawer
  // the card sits in, so its name is one tap away rather than on the page.
  await expect(page.getByText('Debts', { exact: true })).toBeVisible();
  const card = page.getByTestId('type-drawer-debts:credit_card');
  await expect(card).toContainText('Credit card');
  await expect(card).toContainText('10.000.000');
  await card.click();
  await expect(page.getByText('BCA KrisFlyer')).toBeVisible();
});

/**
 * A list of everything you own is as long as the accounts you have opened, so the balance sheet folds it by what each
 * account *is*: current accounts with current accounts. The drawer carries what it holds and what it comes to, so a
 * type reads without being opened — and it is shut to begin with, because the point of folding a page of names away is
 * that what you have reads as a handful of types.
 */
test('folds each side of the balance sheet by kind, shut to begin with', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'Jenius', 'bank', 'Current balance', '20000000');
  await addAccount(page, 'BCA Dollar', 'savings', 'Current balance', '5000000');

  await page.goto('/net-worth');
  const drawer = page.getByTestId('type-drawer-liquid:bank');
  await expect(drawer).toContainText('Current account');
  await expect(drawer).toContainText('2 accounts');
  await expect(drawer).toContainText('70.000.000');
  await expect(drawer).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('BCA Tahapan')).toHaveCount(0);

  await drawer.click();
  await expect(drawer).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('BCA Tahapan')).toBeVisible();
  await expect(page.getByText('Jenius')).toBeVisible();

  // A saving account is a kind of its own, so it sits behind its own drawer rather than under the bank.
  await expect(page.getByTestId('type-drawer-liquid:savings')).toContainText('1 account');
});

/**
 * A debt is read by what it *is* — a card, a loan, a person — and not by when it falls due: "due within a year" and
 * "long-term" are a schedule, and beside a column of asset kinds the two of them answer a different question. The bar
 * divides the same way the drawers do, so the side reads the same from either end.
 */
test('reads what you owe by kind rather than by when it falls due', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '10000000');
  // A mortgage with months left falls partly within the year and partly later: the sheet splits it into two groups,
  // and the list of what is owed must still name it once.
  await openLoan(page, { kind: 'Multi-purpose loan', name: 'KPR BCA', owed: '250000000', months: '60', lender: 'Bank' });

  await page.goto('/net-worth');
  await expect(page.getByText('Due within a year')).toHaveCount(0);
  await expect(page.getByText('Long-term', { exact: true })).toHaveCount(0);

  // One group for the side, with a drawer a kind under it, each carrying the whole of what that kind is owed.
  await expect(page.getByText('Debts', { exact: true })).toBeVisible();
  await expect(page.getByTestId('type-drawer-debts:credit_card')).toContainText('10.000.000');
  await expect(page.getByTestId('type-drawer-debts:loan')).toContainText('250.000.000');

  // Opening the loan's drawer shows the debt itself: one row, not one row per part of its schedule.
  await page.getByTestId('type-drawer-debts:loan').click();
  await expect(page.getByText('KPR BCA')).toHaveCount(1);

  // And the bar above them divides into the same kinds, as shares.
  await expect(page.getByText(/Credit card \d+%/)).toBeVisible();
  await expect(page.getByText(/Loan \d+%/)).toBeVisible();
});

/**
 * The assets side follows the Add asset catalogue's own taxonomy rather than the plan group an asset is filed under:
 * gold is its own family — "Intangible and other" — and not a line inside Investments.
 */
test('reads the assets in the catalogue’s families', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addGold(page);

  await page.goto('/net-worth');
  /*
   * Gold is a family of its own, and inside it a kind of its own: the section says "Gold bullion" even though gold is
   * the only thing in it, because that name is the answer the section exists to give — and the holding itself is one
   * tap away inside the drawer.
   */
  const gold = page.getByTestId('type-drawer-other:gold');
  await expect(gold).toContainText('Gold bullion');
  await expect(gold).toContainText('1 account');
  await expect(page.getByTestId('sheet-section-invest').getByText('Antam gold bars')).toHaveCount(0);
  await expect(page.getByTestId('sheet-section-other').getByText('Antam gold bars')).toHaveCount(0);

  await gold.click();
  await expect(page.getByTestId('sheet-section-other').getByText('Antam gold bars')).toBeVisible();
});

/**
 * The figure is read over a range, and the range is chosen under the line it governs: six of them, from the half year
 * the page opens on to everything the snapshots hold.
 */
test('reads the figure over a range chosen under the line', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth');
  const ranges = page.getByRole('radiogroup', { name: 'Range' });
  await expect(ranges.getByRole('radio')).toHaveCount(6);
  await expect(ranges.getByRole('radio', { name: '6M' })).toHaveAttribute('aria-checked', 'true');

  // Half a year of months is half a year of points on the line, and the range is what decides how many.
  const points = async () => ((await page.getByTestId('net-worth-line').first().getAttribute('points')) ?? '').split(' ').length;
  expect(await points()).toBe(6);

  await ranges.getByRole('radio', { name: '5Y' }).click();
  await expect(ranges.getByRole('radio', { name: '5Y' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(points).toBe(60);

  // And the change the figure has made is under it: the arrow says which way it went, and the word beside the arrow is
  // what a screen reader is given in its place.
  await expect(page.getByTestId('net-worth')).toContainText(/[▲▼] (Up|Down) Rp/);
});

/**
 * The chart prints no axis at all: what a grid and a pair of axes would have said is asked for instead, a month at a
 * time — a tap on any part of the drawing reads the month nearest it, with the figure, and the arrows and Escape do the
 * same from a keyboard. One number read on demand beats thirty printed small enough to be none.
 */
test('reads a month from the part of the line that was tapped', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth');
  // Nothing is read until it is asked for: no gridline, no axis figure, no month name on the drawing.
  await expect(page.getByTestId('net-worth-reading')).toHaveCount(0);

  const plot = page.getByTestId('net-worth-plot');
  const box = (await plot.boundingBox())!;
  await plot.click({ position: { x: box.width - 6, y: box.height / 2 } });

  const reading = page.getByTestId('net-worth-reading');
  await expect(reading).toBeVisible();
  await expect(reading).toContainText(/Rp/);
  // The last month drawn is the month we are in, and a tap at the line's own end reads it.
  await expect(reading).toContainText(new Date().toLocaleDateString('en-GB', { month: 'short' }));

  // The keyboard walks the same months, and Escape lets go.
  const chart = page.getByRole('group', { name: /Net worth by month/ });
  await chart.press('ArrowLeft');
  await expect(reading).toBeVisible();
  await chart.press('Escape');
  await expect(page.getByTestId('net-worth-reading')).toHaveCount(0);
});

test('says it does not know the cash-flow ratios until there are transactions', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  // The ratios are a screen of their own, one tap from Net worth's top corner.
  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Financial health' }).click();
  await expect(page).toHaveURL(/\/net-worth\/health$/);
  await expect(page.getByRole('heading', { name: 'Financial health' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Savings ratio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Surplus' })).toBeVisible();
  await expect(page.getByText('Not enough data').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Debt to assets' })).toBeVisible();
});

test('switches the ratios between the rolling year and a calendar year', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/net-worth/health');
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
 * The three sections are the corner's `…`, and a desktop is this app's highest tier: middle click and "open link in
 * new tab" have to work on them. Only a real `<a href>` gives a browser that — a row that calls `navigate` looks
 * identical and answers none of it — so the href is what is asserted.
 */
test('every net-worth section is a real link in the corner menu, so it can be opened in a new tab', async ({ page }) => {
  await page.goto('/net-worth');
  await page.getByRole('button', { name: 'More' }).click();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveText(['Assets', 'Buy & sell', 'Debts']);
  expect(await items.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href')))).toEqual(['/net-worth/assets', '/net-worth/trades', '/net-worth/loans']);

  // And each one goes there: the section opens as its own screen, with Net worth as the way back.
  await page.getByRole('menuitem', { name: 'Debts' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
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
  // The ratios are a screen of their own and read the same rows: an empty account needs no rate there either.
  await page.goto('/net-worth/health');
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
  // The balance sheet reads the same rows, with USD at 0: it names the rate instead of a figure.
  await expect(page.getByTestId('balance-sheet-missing')).toContainText('No USD rate yet');
  // And so do the ratios, on their own screen.
  await page.goto('/net-worth/health');
  await expect(page.getByTestId('ratios-missing')).toContainText('No USD rate yet, so the ratios cannot be worked out.');
  await expect(page.getByRole('heading', { name: 'Debt to assets' })).toHaveCount(0);
});
