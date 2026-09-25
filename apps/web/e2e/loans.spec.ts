import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** A debt's own line on Debts: its testid is the account's id, so a row is found by the words on it. */
const debtRow = (page: Page, name: string) => page.getByTestId(/^debt-row-/).filter({ hasText: name });

/** The label the old inline form used went with it; the kind decides what the picker asks for now. */
async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await openAccount(page, { subtype: type, name, balance: amount });
}

/** Onboards a KPR already running: the account holds what is still owed, the terms say on what basis. */
async function addKpr(page: Page, { asset }: { asset?: string } = {}) {
  // The terms are written on the loan's own page, which already knows which loan this is.
  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').fill('Bank BTN');
  await page.getByLabel(/Amount borrowed/).fill('700000000');
  await page.getByLabel('Rate a year (%)').fill('9');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').fill('180');
  await page.getByLabel('Payment day').fill('25');
  if (asset) await page.getByLabel('What it bought').selectOption({ label: asset });
  await page.getByRole('button', { name: 'Save terms' }).click();
  // Saving is a round trip, and every spec reloads the page afterwards; a page load while the write is in flight
  // takes the write with it. The schedule appearing is the write landing.
  await expect(page.getByText('Where this loan stands')).toBeVisible();
  // Debts lists a loan before it has terms, so its link alone does not say the save landed: its terms do.
  await page.goto('/net-worth/loans');
  await expect(debtRow(page, 'KPR Bintaro')).toContainText('Bank BTN');
}

test('onboards a loan already running and reads its next twelve months', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  // Debts lists the loan at what is still owed, the ledger's figure, under Loans.
  await expect(debtRow(page, 'KPR Bintaro')).toContainText('700.000.000');
  // The instalments the banks ask for each month moved under the Loans group. `addKpr` never fills "Payment each
  // month" — the form invites you to leave it blank — and the list used to read that stored blank back as `Rp 0`.
  // It is the instalment, worked out from what the ledger says is owed, gated on being greater than zero.
  const instalments = page.getByText('The instalments the banks ask for each month');
  await expect(instalments).toContainText(/7\.\d{3}\.\d{3}/);
  await expect(instalments).not.toContainText(/Rp\s0(?!\d)/);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await expect(page.getByText(/700\.000\.000/).first()).toBeVisible();

  // Twelve rows to start with, headed by the next payment due from today.
  await expect(page.getByRole('row')).toHaveCount(13);
  await expect(page.getByText('2026-09-25').first()).toBeVisible();
});

test('a loan’s terms are corrected from the loan itself, and the schedule follows', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await expect(page.getByText('Where this loan stands')).toBeVisible();

  // The form opens with what is on file, so a tenor typed wrong is corrected rather than typed again.
  await page.getByRole('button', { name: 'Edit terms' }).click();
  await expect(page.getByLabel('Lender')).toHaveValue('Bank BTN');
  await expect(page.getByLabel('Tenor in months')).toHaveValue('180');
  await expect(page.getByLabel('Rate a year (%)')).toHaveValue('9');
  await page.getByLabel('Tenor in months').fill('120');
  await page.getByRole('button', { name: 'Save terms' }).click();

  // The schedule is rebuilt from the new tenor, and the list says the shorter term.
  await expect(page.getByText('Where this loan stands')).toBeVisible();
  await page.goto('/net-worth/loans');
  await expect(debtRow(page, 'KPR Bintaro')).toContainText('Bank BTN · 9% · 120 months');
});

/**
 * The same fault as `/tax-report`, on the same day: `useLoan` handed TanStack Query the legal `undefined`
 * that `loanFor` returns for an account with no terms, and the library refuses it. The `<Empty>` below was
 * written for exactly this and could never render, because a query that errored is never `isSuccess`.
 */
test('a loan with no terms says so, instead of showing a red error box', async ({ page }) => {
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');

  await page.goto('/net-worth/loans/not-a-loan-with-terms');

  // The empty state first: it is what proves the query settled, and only then is "no error box" an assertion
  // about the settled page rather than about a page that has not finished asking yet.
  await expect(page.getByText('This loan has no terms yet.')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('records the payment the form filled in, and the balance falls', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  // The form fills itself in from the next scheduled row; saving it as it stands is the common case.
  await page.getByRole('button', { name: 'Save payment' }).click();

  await expect(page.getByText(/697\.992\.615/).first()).toBeVisible();

  // Interest is spending; the principal is not.
  await page.goto('/spending');
  await expect(page.getByText(/5\.250\.000/).first()).toBeVisible();
});

test('a rate change moves the payment without posting anything', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Rate change' }).click();
  await page.getByLabel('From').fill('2026-02-25');
  await page.getByLabel('New rate a year (%)').fill('11');
  await page.getByRole('button', { name: 'Save rate change' }).click();

  await expect(page.getByText('11%')).toBeVisible();

  // No money moved, so the bank balance is untouched and no transaction was written.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('500.000.000');
});

test('an extra payment says what it saves before it is written', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Extra payment' }).click();
  await page.getByLabel(/How much/).fill('50000000');

  await expect(page.getByTestId('what-if')).toContainText('months earlier');
  await expect(page.getByTestId('what-if')).toContainText('of interest');

  await page.getByRole('button', { name: 'Save extra payment' }).click();
  await expect(page.getByText(/650\.000\.000/).first()).toBeVisible();
});

test('a loan falls due this year and later, and the balance sheet names it once', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  // The split is the debts screen's reading: the next twelve months of principal, and the rest behind it.
  await page.goto('/net-worth/loans');
  await expect(page.getByTestId('debts-due')).toContainText('Due within a year');
  await expect(page.getByTestId('debts-due')).toContainText('the rest is long term');

  // The balance sheet reads what is owed by kind, so the same loan is one row with the whole of it — the sheet splits
  // it into two groups underneath, and a list built from both of those named it twice.
  await page.goto('/net-worth');
  await expect(page.getByText('Due within a year')).toHaveCount(0);
  // One drawer for the kind, and one loan inside it — shut, so the name is one tap away and the figure on the drawer
  // is the whole of what is owed on it.
  const kpr = page.getByTestId('type-drawer-debts:loan');
  await expect(kpr).toContainText('700.000.000');
  await kpr.click();
  await expect(page.getByText('KPR Bintaro')).toHaveCount(1);
  // 200.000.000 owned against 700.000.000 owed: the figure the whole balance is read against, not a part of it.
  await expect(page.getByTestId('net-worth')).toContainText('500.000.000');
});

test('a card purchase turned into instalments splits into billed and unbilled', async ({ page }) => {
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '12000000');

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA KrisFlyer' }).click();
  await page.getByRole('button', { name: 'Add a plan' }).click();
  await page.getByLabel('What it was').fill('iBox Grand Indonesia');
  await page.getByLabel(/^Total/).fill('12000000');
  await page.getByLabel('Over how many months').fill('12');
  await page.getByRole('button', { name: 'Save plan' }).click();

  await expect(page.getByText('iBox Grand Indonesia')).toBeVisible();
  await expect(page.getByText('earns no points')).toBeVisible();
  await expect(page.getByText(/1\.000\.000 a month/)).toBeVisible();

  // The unbilled part is shown as held inside what the card owes, with the plan behind it on hover.
  const held = page.getByTestId('card-instalments');
  await expect(held).toContainText(/Instalments hold Rp\s[\d.]+/);
  await held.getByText(/Instalments hold/).hover();
  await expect(held.getByRole('tooltip')).toContainText('iBox Grand Indonesia');

  // The tip is drawn in the ink, which turns light at night, so its words take the surface rather than white.
  await page.emulateMedia({ colorScheme: 'dark' });
  const colours = await held.getByRole('tooltip').evaluate((node) => {
    const style = getComputedStyle(node);
    return { text: style.color, fill: style.backgroundColor };
  });
  expect(colours.text).not.toBe(colours.fill);
  expect(colours.text).toBe('rgb(28, 28, 30)');
});

test('a loan in another currency is printed in its own currency, and the monthly total is converted', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // A liability account in dollars, opened at the rate typed for the day it is owed from.
  await openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '20000.00', rate: '16250' });

  // The terms are written on the loan's own page; the list is how the loan is reached.
  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'Dollar car loan' }).click();
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').pressSequentially('Car Finance');
  await page.getByLabel('Amount borrowed (USD)').pressSequentially('24000.00');
  await page.getByLabel('Rate a year (%)').pressSequentially('0');
  await page.getByLabel('How interest is worked out').selectOption('zero');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').pressSequentially('48');
  await page.getByLabel('Payment day').fill('25');
  await page.getByLabel('Payment each month (USD)').pressSequentially('500.00');
  await page.getByRole('button', { name: 'Save terms' }).click();
  // The schedule is the write landing; a page load before it does loses the write. See `addKpr`.
  await expect(page.getByText('Where this loan stands')).toBeVisible();

  // The balance in the loan's own currency — US$20.000,00, not "Rp 2.000.000", which is how 2.000.000 cents
  // would read — and beneath it the same in rupiah at the held rate, naming the rate it used.
  await page.goto('/net-worth/loans');
  const row = debtRow(page, 'Dollar car loan');
  await expect(row).toContainText('US$');
  await expect(row).not.toContainText('Rp 2.000.000');
  await expect(row).toContainText('≈ Rp 325.000.000');
  await expect(row).toContainText('at 16.250');
  // The instalments converted at the rate held for the day: 500 × 16.250.
  await expect(page.getByText('The instalments the banks ask for each month')).toContainText('8.125.000');
});

test('an extra payment reads its penalty in the loan’s own money, cents and all', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // A dollar account to pay from, and a dollar loan with the terms its schedule is worked out from.
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD', balance: '2400.00', rate: '16250' });
  await openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '20000.00', rate: '16250' });

  // The terms are written on the loan's own page; the list is how the loan is reached.
  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'Dollar car loan' }).click();
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').pressSequentially('Car Finance');
  await page.getByLabel('Amount borrowed (USD)').pressSequentially('24000.00');
  await page.getByLabel('Rate a year (%)').pressSequentially('0');
  await page.getByLabel('How interest is worked out').selectOption('zero');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').pressSequentially('48');
  await page.getByLabel('Payment day').fill('25');
  await page.getByLabel('Payment each month (USD)').pressSequentially('500.00');
  await page.getByRole('button', { name: 'Save terms' }).click();
  // The schedule is the write landing; a page load before it does loses the write. See `addKpr`.
  await expect(page.getByText('Where this loan stands')).toBeVisible();
  await page.goto('/net-worth/loans');
  await expect(debtRow(page, 'Dollar car loan')).toContainText('Car Finance');

  await page.getByRole('link', { name: 'Dollar car loan' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await page.getByRole('button', { name: 'Extra payment' }).click();
  await page.getByLabel(/How much/).fill('500.00');
  /*
   * The bank's penalty, written the way a dollar figure is: twelve dollars fifty. The box used to be read with
   * `Number(x.replace(/\./g, ''))`, which is right for rupiah and answers this with `NaN` — so the fee the bank
   * charged went in as nothing and the NaN rode into the ledger beside it.
   */
  await page.getByLabel(/Penalty the bank charges/).pressSequentially('12,50');
  await page.getByRole('button', { name: 'Save extra payment' }).click();

  // The principal falls by the extra alone — a penalty is a fee, never part of the principal — and the fee, with the
  // extra, is exactly what left the dollar account: 2.400 − 500 − 12,50.
  await expect(page.getByText(/19\.500,00/).first()).toBeVisible();
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('listitem').filter({ has: page.getByRole('link', { name: 'Wise USD', exact: true }) })).toContainText('1.887,50');
});
