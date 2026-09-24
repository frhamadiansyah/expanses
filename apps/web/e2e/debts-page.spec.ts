import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { digits, moneyIn, oneOfEach } from './debts-page';
import { forgetRates, openWithPockets } from './pockets';

/**
 * Debts: everything owed, one list in three groups — Loans, Credit cards, Payables — with one converted
 * total, each group's own total, and the split by due date the balance sheet already makes. One list at every
 * width, the way Assets draws what is owned: its own currency on the row, and what that comes to beneath.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/**
 * A debt's own line. The row's testid is the account's id, which a spec cannot know, so a row is found by the
 * words on it — the same way a reader finds it.
 */
const debtRow = (page: Page, name: string) => page.getByTestId(/^debt-row-/).filter({ hasText: name });

test('Debts shows all three groups with the right figures, and the due split is the balance sheet’s', async ({ page }) => {
  await oneOfEach(page);
  await page.goto('/net-worth/loans');

  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  // The whole, converted: 712.500.000 + 16.250.000 + 2.450.000 + 750.000.
  await expect(page.getByTestId('debts-total')).toContainText('Rp 731.950.000');
  await expect(page.getByTestId('debts-total')).toContainText('You owe, in Rupiah');

  // Each group in its own header, in the Assets page's order, with its own total on the header.
  await expect(page.getByRole('heading', { level: 2 })).toContainText(['Loans', 'Credit cards', 'Payables']);
  await expect(page.getByTestId('debts-group-total-loan')).toHaveText('Rp 728.750.000');
  await expect(page.getByTestId('debts-group-total-card')).toHaveText('Rp 2.450.000');
  await expect(page.getByTestId('debts-group-total-person')).toHaveText('Rp 750.000');

  // A debt in dollars is a dollar figure, and beneath it the rupiah that comes to — with the rate it was worked at.
  const dollar = debtRow(page, 'Dollar car loan');
  await expect(dollar).toContainText('US$1.000,00');
  await expect(dollar).toContainText('≈ Rp 16.250.000');
  await expect(dollar).toContainText('at 16.250');

  // A card owes everything not yet paid: the Rp 2.000.000 billed and the Rp 450.000 bought since.
  // The figure is bare, as the group's header names the currency — the same way Assets draws its rows.
  const card = debtRow(page, 'BCA Visa');
  await expect(card).toContainText('2.450.000');
  // One line per debt: which part is billed, and the day the bill falls due, is the card's own page.
  await expect(card.getByText(/unbilled|due \d/)).toHaveCount(0);

  // The mortgage says what it is, the way the Loans page did.
  await expect(debtRow(page, 'KPR BCA')).toContainText('BCA · 9% · 180 months');

  /*
   * Due within a year is this screen's own reading. What the balance sheet says of the same debts is the whole of
   * them — it reads them by kind, so the figure the two screens share is what is owed in total.
   */
  const within = digits(await page.getByTestId('debts-due').innerText());
  expect(within).toBeGreaterThan(3_200_000);
  const owed = digits(moneyIn(await page.getByTestId('debts-total').innerText()));
  await page.goto('/net-worth');
  const owedOnSheet = digits(moneyIn(await page.getByRole('heading', { name: 'Debts', exact: true }).locator('xpath=..').innerText()));
  expect(owedOnSheet).toBe(owed);
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
  await debtRow(page, 'KPR BCA').click();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^/]+$/);
  await expect(page.getByText('Still owed')).toBeVisible();
  // The loan's own page names where back goes by the page's new name.
  await page.getByRole('link', { name: 'Debts', exact: true }).first().click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);

  // A tap anywhere on a row, not only on its name: its own figure opens it.
  await debtRow(page, 'BCA Visa').getByText('2.450.000').click();
  await expect(page).toHaveURL(/\/cards\/[^/?]+/);
  await expect(page.getByRole('heading', { name: 'BCA Visa' })).toBeVisible();
  // It opens raised out of the Wallet stack, and its Unpaid tile is the very figure the Debts row showed.
  await expect(page.getByRole('region', { name: 'Your cards' }).locator('[data-place="raised"]')).toBeVisible();
  await expect(page.getByTestId('tile-unpaid-balance')).toHaveText('Rp 2.450.000');

  await page.goto('/net-worth/loans');
  await debtRow(page, 'Dewi').click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Only Dewi' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dewi', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Show everyone' }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
});

test('the renames are in place: Debts for everything owed, Lend & borrow for people', async ({ page }) => {
  await page.goto('/net-worth');
  // The sections are the corner's `…` now, three rows that are links, each opening a screen of its own.
  await page.getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menuitem')).toHaveText(['Assets', 'Buy & sell', 'Debts']);
  await page.getByRole('menuitem', { name: 'Debts' }).click();
  await expect(page).toHaveURL(/\/net-worth\/loans$/);
  await expect(page.getByRole('heading', { name: 'Debts', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Loans', level: 1 })).toHaveCount(0);
  // Lend & borrow is not one of these sections any more: it left for Cashflow, where the lending happens, and a
  // phone reaches it from that page's ⋯ (`phone-debts-page.spec.ts`). A wide screen has no ⋯ there, so its doors are
  // the ones it always had — a person's row on this page, the Overview's own row, and adding a debt, which lands
  // there.
});

test('the old Lend & borrow address still opens it, with its search', async ({ page }) => {
  await page.goto('/net-worth/debts');
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();
  await page.goto('/net-worth/debts?person=Dewi');
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
});

test('a loan with no terms says so, and its terms are written from the loan itself', async ({ page }) => {
  await openAccount(page, { subtype: 'loan', name: 'KPR Bintaro', balance: '700000000' });

  await page.goto('/net-worth/loans');
  // A loan account with no terms is still owed, so it is listed — and says what it lacks.
  await expect(debtRow(page, 'KPR Bintaro')).toContainText('no terms yet');
  /*
   * The list keeps no terms tool of its own: the loan's own page already knows which loan this is, so it is where
   * the agreement is written — and there is no state in which a tool here would have nothing to offer.
   */
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await expect(page.getByText('This loan has no terms yet')).toBeVisible();
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
  // The schedule is there at once, on the page the terms were written on.
  await expect(page.getByText('Where this loan stands')).toBeVisible();

  await page.goto('/net-worth/loans');
  await expect(debtRow(page, 'KPR Bintaro')).toContainText('Bank BTN · 9% · 180 months');
  await expect(page.getByText('The instalments the banks ask for each month')).toContainText(/7\.\d{3}\.\d{3}/);
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
  const within = digits(await page.getByTestId('debts-due').innerText());
  expect(within).toBeGreaterThan(13_000_000);
  await expect(page.getByText(/No USD rate yet/)).toHaveCount(0);
});

test('a loan paid off leaves the list and the total, and waits under the paid-off loans', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });

  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Personal loan' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Kredit HP');
  await page.getByLabel('Owed now').pressSequentially('3000000');
  await page.getByLabel('Lender').pressSequentially('Kredivo');
  await page.getByLabel('Interest rate').pressSequentially('0');
  await page.getByLabel('Months left').pressSequentially('6');
  await page.getByRole('button', { name: 'Add debt' }).click();
  await expect(page.getByTestId('debts-total')).toContainText('Rp 3.000.000');

  await debtRow(page, 'Kredit HP').click();
  // A payment of everything that is left clears it: the ledger marks the loan paid off.
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Principal (IDR)').fill('');
  await page.getByLabel('Principal (IDR)').pressSequentially('3000000');
  await page.getByRole('button', { name: 'Save payment' }).click();
  await expect(page.getByRole('button', { name: 'Save payment' })).toHaveCount(0);

  await page.goto('/net-worth/loans');
  await expect(debtRow(page, 'Kredit HP')).toHaveCount(0);
  await expect(page.getByTestId('debts-total')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show paid-off loans (1)' }).click();
  await expect(page.getByRole('heading', { name: 'Paid off' })).toBeVisible();
  await expect(page.getByText(/^cleared \d{4}-\d{2}-\d{2}$/)).toBeVisible();
});

test('a card paid past its bill holds the surplus: Unpaid at nothing, and the credit named on both screens', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  await openCard(page, { name: 'BCA Visa' });

  // Rp 100.000 bought on the card, then Rp 350.000 paid on it: the bank holds the difference for you.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Coffee', paidWith: 'BCA Visa', category: 'Groceries', amount: '100000', keyByKey: true });

  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  const tile = page.getByTestId('tile-left-to-pay');
  await expect(tile.getByTestId('tile-unpaid-balance')).toHaveText('Rp 100.000');
  await tile.getByRole('button', { name: 'Pay', exact: true }).click();
  await tile.getByLabel('Amount (IDR)').fill('350000');
  await tile.getByRole('button', { name: 'Record payment' }).click();

  // The card owes nothing — Unpaid is at nothing, exactly as the Debts row says — and the surplus is named under it.
  await expect(tile.getByTestId('tile-unpaid-balance')).toHaveText('Rp 0');
  await expect(tile.getByTestId('tile-credit')).toHaveText('Credit Rp 250.000');

  // And the Debts row says the same thing the card does.
  await page.goto('/net-worth/loans');
  const row = debtRow(page, 'BCA Visa');
  await expect(row).toContainText('Credit Rp 250.000');
  await expect(row).toContainText('0');
  await expect(page.getByTestId('debts-group-total-card')).toHaveText('Rp 0');
});
