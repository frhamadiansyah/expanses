import { expect, test } from '@playwright/test';
import { digits, oneOfEach } from './debts-page';
import { forgetRates, openWithPockets } from './pockets';

/**
 * Debts: everything owed, one list in three groups — Loans, Credit cards, You owe people — with one converted
 * total, each group's own total, and the split by due date the balance sheet already makes. On the desktop it is a
 * table with the balance in each debt's own currency beside its value in rupiah.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('Debts shows all three groups with the right figures, and the due split is the balance sheet’s', async ({ page }) => {
  await oneOfEach(page);
  await page.goto('/net-worth/loans');

  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  // The whole, converted: 712.500.000 + 16.250.000 + 2.450.000 + 750.000.
  await expect(page.getByTestId('debts-total')).toContainText('Rp 731.950.000');
  await expect(page.getByTestId('debts-total')).toContainText('You owe, in Rupiah');

  // Each group in its own header, in the Assets page's order.
  const table = page.getByTestId('debts-table');
  await expect(table.getByRole('columnheader')).toHaveText(['Debt', 'Details', 'Balance', 'In Rupiah', /^Loans\s*Rp\s728\.750\.000$/, /^Credit cards\s*Rp\s2\.450\.000$/, /^You owe people\s*Rp\s750\.000$/]);
  await expect(page.getByTestId('debts-group-total-loan')).toHaveText('Rp 728.750.000');
  await expect(page.getByTestId('debts-group-total-card')).toHaveText('Rp 2.450.000');
  await expect(page.getByTestId('debts-group-total-person')).toHaveText('Rp 750.000');
  // And the same beside the hero.
  await expect(page.getByTestId('debts-side-loan')).toContainText('728.750.000');
  await expect(page.getByTestId('debts-side-card')).toContainText('2.450.000');
  await expect(page.getByTestId('debts-side-person')).toContainText('750.000');

  // A debt in dollars is a dollar figure, and its rupiah value names the rate it was worked at.
  const dollar = page.getByRole('row', { name: /Dollar car loan/ });
  await expect(dollar.getByRole('cell').nth(2)).toHaveText('US$1.000,00');
  await expect(dollar.getByRole('cell').nth(3)).toContainText('16.250.000');
  await expect(dollar.getByRole('cell').nth(3)).toContainText('at 16.250');

  // A card owes everything not yet paid: the Rp 2.000.000 billed and the Rp 450.000 bought since.
  const card = page.getByRole('row', { name: /BCA Visa/ });
  await expect(card.getByRole('cell').nth(2)).toHaveText('Rp 2.450.000');
  await expect(card.getByRole('cell').nth(1)).toHaveText(/^due \d+ \w{3} · 450\.000 unbilled$/);

  // The mortgage says what it is, the way the Loans page did.
  await expect(page.getByRole('row', { name: /KPR BCA/ }).getByRole('cell').nth(1)).toHaveText('BCA · 9% · 180 months');

  // Due within a year and long term add up to the whole, and within a year is the balance sheet's own figure.
  const within = digits(await page.getByTestId('debts-side-within-year').innerText());
  const long = digits(await page.getByTestId('debts-side-long-term').innerText());
  expect(within).toBeGreaterThan(3_200_000);
  expect(within + long).toBe(731_950_000);
  await page.goto('/net-worth');
  const sheetWithin = page.getByRole('heading', { name: 'Due within a year' }).locator('xpath=..');
  expect(digits(await sheetWithin.innerText())).toBe(within);
});

test('＋ on Debts opens the chooser that adds every kind of debt', async ({ page }) => {
  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'Add a debt' }).click();
  await expect(page).toHaveURL(/\/debts\/new$/);
  // A loan with terms, a card, and money borrowed from someone: every kind of debt the app keeps.
  for (const kind of ['Home mortgage', 'Vehicle leasing', 'Credit card', 'Personal loan', 'Online loan or paylater', 'Affiliate debt', 'Other debts'])
    await expect(page.getByRole('button', { name: new RegExp(`^${kind}`) })).toBeVisible();
});

test('each debt opens its own place: a loan its schedule, a card the card, a person Lend & borrow for them', async ({ page }) => {
  await oneOfEach(page);

  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'KPR BCA', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^/]+$/);
  await expect(page.getByText('Still owed')).toBeVisible();
  // The loan's own page names where back goes by the page's new name.
  await page.getByRole('link', { name: 'Debts', exact: true }).first().click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);

  // A click anywhere on a row, not only its name, goes to the same place.
  await page.getByRole('row', { name: /BCA Visa/ }).getByRole('cell').nth(2).click();
  await expect(page).toHaveURL(/\/cards\/[^/?]+/);
  await expect(page.getByRole('heading', { name: 'BCA Visa' })).toBeVisible();
  // It opens raised out of the Wallet stack, and its Unpaid tile is the very figure the Debts row showed.
  await expect(page.getByRole('region', { name: 'Your cards' }).locator('[data-place="raised"]')).toBeVisible();
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 2.450.000');

  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'Dewi', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Only Dewi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dewi', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Show everyone' }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
});

test('the renames are in place: Debts for everything owed, Lend & borrow for people', async ({ page }) => {
  await page.goto('/net-worth');
  const tabs = page.getByRole('radiogroup', { name: 'Net worth sections' }).getByRole('radio');
  await expect(tabs).toHaveText(['Overview', 'Assets', 'Buy & sell', 'Debts', 'Lend & borrow']);
  await page.getByRole('radio', { name: 'Debts' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Loans', level: 1 })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Lend & borrow' }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();
});

test('the old Lend & borrow address still opens it, with its search', async ({ page }) => {
  await page.goto('/net-worth/debts');
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();
  await page.goto('/net-worth/debts?person=Dewi');
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
});

test('every Loans page action is still there: add terms, cancel, and the instalments line', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially('KPR Bintaro');
  await page.getByLabel('Type').selectOption('loan');
  await page.getByLabel('Amount owed now').pressSequentially('700000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'KPR Bintaro', exact: true })).toBeVisible();

  await page.goto('/net-worth/loans');
  // A loan account with no terms is still owed, so it is listed — and says what it lacks.
  await expect(page.getByRole('row', { name: /KPR Bintaro/ })).toContainText('no terms yet');
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Lender')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').pressSequentially('Bank BTN');
  await page.getByLabel(/Amount borrowed/).pressSequentially('700000000');
  await page.getByLabel('Rate a year (%)').pressSequentially('9');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').pressSequentially('180');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByRole('row', { name: /KPR Bintaro/ })).toContainText('Bank BTN · 9% · 180 months');
  await expect(page.getByText('The instalments the banks ask for each month')).toContainText(/7\.\d{3}\.\d{3}/);
  // Every loan account now has its terms, and the form says so, with its Close.
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await expect(page.getByText('Every loan account already has its terms.')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: 'Add loan terms' })).toBeVisible();
});

test('an asset whose rate is missing does not hide the due split, which is made of the debts', async ({ page }, testInfo) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // The mortgage through the chooser: one rupiah debt, with the terms its schedule is read from.
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Home mortgage' }).click();
  await page.getByLabel('Name', { exact: true }).fill('KPR BCA');
  await page.getByLabel('Owed now').fill('712500000');
  await page.getByLabel('Lender').fill('BCA');
  await page.getByLabel('Interest rate').fill('9');
  await page.getByLabel('Months left').fill('180');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);

  // A funded dollar holding, and then no rate anywhere on the device: the balance sheet names USD as missing, and it
  // names it on the *asset* side — the debts are all rupiah.
  await openWithPockets(page, { name: 'Unpriced Valas', pockets: [{ currency: 'IDR', balance: '5400000' }, { currency: 'USD', balance: '2400', rate: '16250' }] });
  await forgetRates(page, testInfo.outputPath('no-rates.sqlite3'));

  await page.goto('/net-worth/loans');
  // The whole and the split are both figures, and they add up: what is owed never waits on what is owned.
  await expect(page.getByTestId('debts-total')).toContainText('Rp 712.500.000');
  const within = digits(await page.getByTestId('debts-side-within-year').innerText());
  const long = digits(await page.getByTestId('debts-side-long-term').innerText());
  expect(within).toBeGreaterThan(13_000_000);
  expect(within + long).toBe(712_500_000);
  await expect(page.getByText(/No USD rate yet/)).toHaveCount(0);
});

test('a loan paid off leaves the list and the total, and waits under the paid-off loans', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').pressSequentially('50000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Personal loan' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Kredit HP');
  await page.getByLabel('Owed now').pressSequentially('3000000');
  await page.getByLabel('Lender').pressSequentially('Kredivo');
  await page.getByLabel('Interest rate').pressSequentially('0');
  await page.getByLabel('Months left').pressSequentially('6');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page.getByTestId('debts-total')).toContainText('Rp 3.000.000');

  await page.getByRole('link', { name: 'Kredit HP', exact: true }).click();
  // A payment of everything that is left clears it: the ledger marks the loan paid off.
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Principal (IDR)').fill('');
  await page.getByLabel('Principal (IDR)').pressSequentially('3000000');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByRole('button', { name: 'Save payment' })).toHaveCount(0);

  await page.goto('/net-worth/loans');
  await expect(page.getByRole('row', { name: /Kredit HP/ })).toHaveCount(0);
  await expect(page.getByTestId('debts-total')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show paid-off loans (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Paid off' })).toBeVisible();
  await expect(page.getByText(/^cleared \d{4}-\d{2}-\d{2}$/)).toBeVisible();
});
