import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccount } from './accounts';
import { backToCardFromPlans, startPlan } from './card-section';
import { openDrawers } from './drawers';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** This month's 25th, as the schedule writes it: the first row it works out for a loan paid on the 25th. */
function nextTwentyFifth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-25`;
}

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
  // The list folds its rows into a drawer per kind of debt, so the row is one tap away — the reader's own tap.
  await openDrawers(page);
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
  await expect(page.getByTestId('loan-card')).toBeVisible();
  // Debts lists a loan before it has terms, so its link alone does not say the save landed: its terms do.
  await page.goto('/net-worth/loans');
  await openDrawers(page);
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

  await openDrawers(page);
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await expect(page.getByText(/700\.000\.000/).first()).toBeVisible();

  // The schedule is a sheet of its own behind the Next payment group: twelve rows to start with, headed by the next
  // payment due from today, and every month on asking.
  await page.getByRole('button', { name: 'Schedule' }).click();
  const schedule = page.getByRole('dialog', { name: 'Schedule' });
  await expect(schedule.getByRole('row')).toHaveCount(13);
  await expect(schedule.getByText(nextTwentyFifth()).first()).toBeVisible();
  await schedule.getByRole('button', { name: 'Show every month' }).click();
  await expect(schedule.getByRole('row')).not.toHaveCount(13);
});

test('a loan’s terms are corrected from the loan itself, and the schedule follows', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await openDrawers(page);
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await expect(page.getByTestId('loan-card')).toBeVisible();

  // The form opens with what is on file, so a tenor typed wrong is corrected rather than typed again. It waits behind ⋯.
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Edit terms' }).click();
  await expect(page.getByLabel('Lender')).toHaveValue('Bank BTN');
  await expect(page.getByLabel('Tenor in months')).toHaveValue('180');
  await expect(page.getByLabel('Rate a year (%)')).toHaveValue('9');
  await page.getByLabel('Tenor in months').fill('120');
  await page.getByRole('button', { name: 'Save terms' }).click();

  // The schedule is rebuilt from the new tenor, and the list says the shorter term. The card stays on screen under
  // the sheet, so it says nothing about the save; the sheet closing is the write landing.
  await expect(page.getByRole('dialog', { name: 'Edit terms' })).toHaveCount(0);
  await expect(page.getByTestId('loan-card')).toBeVisible();
  await page.goto('/net-worth/loans');
  await openDrawers(page);
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

  await openDrawers(page);
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  // The form fills itself in from the next scheduled row; saving it as it stands is the common case.
  await page.getByRole('button', { name: 'Save payment' }).click();

  // Less than the 700.000.000 it was, by the principal of the month's row (which month that is moves with today).
  await expect(page.getByTestId('card-figure')).not.toContainText('700.000.000');
  await expect(page.getByTestId('card-figure')).toContainText(/69\d\.\d{3}\.\d{3}/);
  await expect(page.getByTestId('loan-payment')).toContainText('5.250.000 interest');

  // Interest is spending; the principal is not.
  await page.goto('/spending');
  await expect(page.getByText(/5\.250\.000/).first()).toBeVisible();
});

test('a rate change moves the payment without posting anything', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '200000000');
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '700000000');
  await addKpr(page);

  await openDrawers(page);
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Rate change' }).click();
  await page.getByLabel('From', { exact: true }).fill('2026-02-25');
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

  await openDrawers(page);
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Pay extra', exact: true }).click();
  await page.getByLabel(/How much/).fill('50000000');

  await expect(page.getByTestId('what-if-saved')).toContainText(/Interest saved\s*Rp/);
  await expect(page.getByTestId('what-if-finish')).toContainText('sooner');

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
  // is the whole of what is owed on it. The kind is the item the picker opened the loan as; a loan opened on Accounts
  // with no kind of its own folds as a multi-purpose loan, which is the picker's default for a plain loan.
  const kpr = page.getByTestId('type-drawer-debts:multi_purpose_loan');
  await expect(kpr).toContainText('700.000.000');
  await kpr.click();
  await expect(page.getByText('KPR Bintaro')).toHaveCount(1);
  // 200.000.000 owned against 700.000.000 owed: the figure the whole balance is read against, not a part of it.
  await expect(page.getByTestId('net-worth')).toContainText('500.000.000');
});

test('a card purchase turned into instalments splits into billed and unbilled', async ({ page }) => {
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '12000000');

  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA KrisFlyer' }).click();
  // With no plan the card page shows no Instalments box: the first is added from Settings, Instalments, ＋.
  await expect(page.getByTestId('card-instalments')).toHaveCount(0);
  await startPlan(page);
  const sheet = page.getByRole('dialog', { name: 'New instalment plan' });
  await sheet.getByLabel('What it was').fill('iBox Grand Indonesia');
  await sheet.getByLabel(/^Total/).fill('12000000');
  await sheet.getByLabel('Months').fill('12');
  await sheet.getByRole('button', { name: 'Save plan' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('card-instalment')).toHaveCount(1);
  await backToCardFromPlans(page);

  // The plan is managed where it is read: on the card's summary, a row per plan with its months and what it holds.
  const held = page.getByTestId('card-instalments');
  // The held figure is the limit bar's, not the Instalments header's.
  await expect(held.getByRole('heading', { name: 'Instalments' })).not.toContainText('held');
  const plan = held.getByTestId('card-instalment');
  await expect(plan).toContainText('iBox Grand Indonesia');
  await expect(plan).toContainText(/\d+ of 12 paid/);
  await expect(plan).toContainText(/Rp\s1\.000\.000 a month/);

  // The bin is gone: the row is the way in, and it carries a chevron.
  await expect(plan.getByRole('button', { name: 'Remove iBox Grand Indonesia' })).toHaveCount(0);

  // Tapping the row opens the plan's own page (card instalments, option C): its progress, Count spending, its months.
  await plan.getByRole('button', { name: 'Open iBox Grand Indonesia' }).click();
  const planPage = page.getByTestId('instalment-plan-page');
  await expect(planPage).toBeVisible();
  await expect(planPage.getByTestId('instalment-progress')).toContainText(/\d+ of 12 paid/);
  // A new plan counts each month; with no purchase chosen the footer says where.
  await expect(planPage.getByRole('radio', { name: 'Each month' })).toHaveAttribute('aria-checked', 'true');
  await expect(planPage).toContainText('Under Uncategorised, as no purchase is chosen.');
  await planPage.getByRole('radio', { name: 'At purchase' }).click();
  await expect(planPage.getByRole('radio', { name: 'At purchase' })).toHaveAttribute('aria-checked', 'true');
  await expect(planPage).toContainText('At purchase: no purchase is chosen, so nothing counts as spending.');

  // ✎ opens the plan to change; a new total and fewer months change its monthly figure and its last month.
  await page.getByRole('button', { name: 'Edit plan' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit instalment plan' });
  const endsBefore = (await edit.textContent())!.match(/Ends\s*([A-Z][a-z]+ \d{4})/)![1]!;
  await expect(edit.getByLabel('What it was')).toHaveValue('iBox Grand Indonesia');
  // What the row no longer spells out is in the sheet: billed, still held and when it ends.
  await expect(edit.getByText('So far')).toBeVisible();
  await expect(edit.getByLabel('Billed', { exact: true }).first()).toBeVisible();
  await expect(edit.getByLabel('Still held', { exact: true }).first()).toBeVisible();
  await expect(edit.getByLabel('Ends', { exact: true }).first()).toBeVisible();
  await expect(edit.getByLabel(/^Total/)).toHaveValue('12.000.000');
  await expect(edit.getByLabel('Months')).toHaveValue('12');
  await edit.getByLabel(/^Total/).fill('9000000');
  await edit.getByLabel('Months').fill('6');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(planPage.getByTestId('instalment-progress')).toContainText(/\d+ of 6 paid/);
  await expect(planPage.getByTestId('instalment-progress')).toContainText(/Rp\s1\.500\.000 a month/);
  await page.getByRole('button', { name: 'Edit plan' }).click();
  expect((await edit.textContent())!.match(/Ends\s*([A-Z][a-z]+ \d{4})/)![1]).not.toBe(endsBefore);
  await edit.getByRole('button', { name: 'Close' }).click();

  // Removing asks first, in an alert; Not now keeps it, Remove plan takes it away and leaves the purchase alone.
  await page.getByRole('button', { name: 'Edit plan' }).click();
  await edit.getByRole('button', { name: 'Remove plan' }).click();
  const alert = page.getByRole('alertdialog', { name: 'Remove plan' });
  await expect(alert).toContainText('The purchase it came from stays as it is.');
  await alert.getByRole('button', { name: 'Not now' }).click();
  await expect(planPage).toBeVisible();
  await edit.getByRole('button', { name: 'Remove plan' }).click();
  await alert.getByRole('button', { name: 'Remove plan' }).click();
  await expect(edit).toHaveCount(0);
  // Back where the plan was opened from, the card's page: the last plan gone, the box goes too.
  await expect(planPage).toHaveCount(0);
  await expect(page.getByTestId('card-instalments')).toHaveCount(0);
});

test('a loan in another currency is printed in its own currency, and the monthly total is converted', async ({ page }) => {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  // A liability account in dollars, opened at the rate typed for the day it is owed from.
  await openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '20000.00', rate: '16250' });

  // The terms are written on the loan's own page; the list is how the loan is reached.
  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: 'Dollar car loan' }).click();
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').pressSequentially('Car Finance');
  await page.getByLabel('Amount borrowed').pressSequentially('24000,00');
  await page.getByLabel('Rate a year (%)').pressSequentially('0');
  await page.getByLabel('How interest is worked out').selectOption('zero');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').pressSequentially('48');
  await page.getByLabel('Payment day').fill('25');
  await page.getByLabel('Payment each month').pressSequentially('500,00');
  await page.getByRole('button', { name: 'Save terms' }).click();
  // The schedule is the write landing; a page load before it does loses the write. See `addKpr`.
  await expect(page.getByTestId('loan-card')).toBeVisible();

  // The balance in the loan's own currency — US$20.000,00, not "Rp 2.000.000", which is how 2.000.000 cents
  // would read — and beneath it the same in rupiah at the held rate, naming the rate it used.
  await page.goto('/net-worth/loans');
  await openDrawers(page);
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
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD', balance: '2400,00', rate: '16250' });
  await openAccount(page, { subtype: 'loan', name: 'Dollar car loan', currency: 'USD', balance: '20000.00', rate: '16250' });

  // The terms are written on the loan's own page; the list is how the loan is reached.
  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: 'Dollar car loan' }).click();
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  await page.getByLabel('Lender').pressSequentially('Car Finance');
  await page.getByLabel('Amount borrowed').pressSequentially('24000,00');
  await page.getByLabel('Rate a year (%)').pressSequentially('0');
  await page.getByLabel('How interest is worked out').selectOption('zero');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await page.getByLabel('Tenor in months').pressSequentially('48');
  await page.getByLabel('Payment day').fill('25');
  await page.getByLabel('Payment each month').pressSequentially('500,00');
  await page.getByRole('button', { name: 'Save terms' }).click();
  // The schedule is the write landing; a page load before it does loses the write. See `addKpr`.
  await expect(page.getByTestId('loan-card')).toBeVisible();
  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await expect(debtRow(page, 'Dollar car loan')).toContainText('Car Finance');

  await page.getByRole('link', { name: 'Dollar car loan' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await page.getByRole('button', { name: 'Pay extra', exact: true }).click();
  // Typed the app's way, grouped as it goes: a dot is a thousands mark and the comma starts the cents.
  await page.getByLabel(/How much/).pressSequentially('500,00');
  await expect(page.getByLabel(/How much/)).toHaveValue('500,00');
  /*
   * The bank's penalty, written the way a dollar figure is: twelve dollars fifty. The box used to be read with
   * `Number(x.replace(/\./g, ''))`, which is right for rupiah and answers this with `NaN` — so the fee the bank
   * charged went in as nothing and the NaN rode into the ledger beside it.
   */
  await page.getByRole('textbox', { name: /Penalty the bank charges/ }).pressSequentially('12,50');
  await page.getByRole('button', { name: 'Save extra payment' }).click();

  // The principal falls by the extra alone — a penalty is a fee, never part of the principal — and the fee, with the
  // extra, is exactly what left the dollar account: 2.400 − 500 − 12,50.
  await expect(page.getByText(/19\.500,00/).first()).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Wise USD', '1.887,50');
});
