import { expect, type Locator, type Page, test } from '@playwright/test';
import { openLoan, personRow } from './people';
import { openAccount, openAccountHistory, openCard, walletCard, openFace } from './accounts';
import { cardPage, chooseCardPayFrom, openCardPay, openStatementPay, saveCardTerms, showCardBack } from './card-section';
import { addForm, choosePayment, saveButton, chooseGoal } from './add-transaction';
import { openNewAsset, fillDay, pastPurchase } from './add-asset';
import { openDrawers } from './drawers';
import { addBill, addMoneyAccount, goalCard, jeniusWithTwoGoals, openAccountPage, openExpense, typeAmount } from './set-aside';
import { paySeveral } from './bills-desk';
import { pickDraftCategory } from './review';
import { openShortTrade, openTradeDetails, pickTradeCash, recordShortTrade, shortTrade } from './trades';

/*
 * Every door that pays money out of an account with money set aside, on the laptop's figures: Jenius holds
 * Rp 42.500.000, promises Rp 37.500.000 (Emergency fund 30.000.000 first, Umrah 7.500.000), so Rp 5.000.000 is free
 * and a Rp 6.800.000 payment is Rp 1.800.000 over. Each door asks, keeps its save shut until answered, and the
 * answer lands on the goal as a shortfall of exactly what went over — not the whole payment, and not nothing.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = local(now);
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));

async function expectShort(page: Page, goal: string, figure: RegExp) {
  // The goal's own page says it twice since Task 13 — under the figure and on the Funded-by row — and both carry the same figure.
  await expect((await goalCard(page, goal)).getByText(figure).first()).toBeVisible();
}

/** Answers the question in `scope`: the Emergency fund, borrowing. */
async function borrowFromEmergencyFund(scope: ReturnType<Page['locator']>) {
  await scope.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await scope.getByRole('button', { name: 'No — borrowing from it' }).click();
}

// ── Cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addCard(page: Page) {
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await openFace(walletCard(page, 'BCA Visa'));
  await cardPage(page, 'Settings');
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').pressSequentially('31');
  await page.getByLabel('Due date').pressSequentially('15');
  await saveCardTerms(page);
  await page.getByRole('button', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
  await expect(page.getByTestId('statement-range')).toBeVisible();
}

async function buyOnCard(page: Page, note: string, amount: string, on: string) {
  const form = await openExpense(page, 'BCA Visa');
  await typeAmount(page, form, amount);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').pressSequentially(note);
  await form.getByLabel('Date').fill(on);
  await form.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(form).toHaveCount(0);
}

async function openCardPage(page: Page) {
  await page.goto('/wallet');
  await openFace(page.getByRole('link', { name: 'BCA Visa' }));
}

test('paying the card bill from Jenius asks, and the Emergency fund lends the 1.800.000', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addCard(page);
  await buyOnCard(page, 'Laptop', '6800000', LAST_MONTH);
  await openCardPage(page);

  const tile = page.getByTestId('tile-left-to-pay');
  // The round Pay opens the Add screen locked to paying the card; From is Jenius.
  const form = await openCardPay(page);
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue(/^6\.?800\.?000$/);
  // Goals exist, but a card payment is never saving toward one: no Goal row. The question below is another matter.
  await expect(form.getByRole('button', { name: /^Goal/ })).toHaveCount(0);
  await chooseCardPayFrom(form, 'Jenius');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(saveButton(form)).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await showCardBack(page);
  await expect(tile).toContainText('Paid in full');

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('paying chosen purchases now from Jenius asks the same question', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addCard(page);
  await buyOnCard(page, 'Laptop', '6800000', TODAY);
  await openCardPage(page);
  await cardPage(page, 'Statement');

  await page.getByLabel('Pay Laptop').check();
  // The same Pay credit card screen as the card's Pay: From chosen, then the question.
  const form = await openStatementPay(page);
  await expect(form.getByRole('button', { name: /^Goal/ })).toHaveCount(0);
  await chooseCardPayFrom(form, 'Jenius');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(saveButton(form)).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByLabel(/^Laptop, paid on/)).toBeChecked();

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

/**
 * An Enter that went round the question would have posted before the answer: the question is still up after a wait long
 * enough for a write to land, and in the end exactly one row was recorded.
 */
async function enterWaitsForTheQuestion(page: Page, field: Locator) {
  await field.press('Enter');
  await page.waitForTimeout(1_000);
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
}

/** Exactly one row on Cashflow — or, for lending, which Cashflow does not list (owner 2026-11-16), on `from`'s history. */
async function expectRecordedOnce(page: Page, text: RegExp, from?: string) {
  if (from) await openAccountHistory(page, from);
  else await page.goto('/transactions');
  await expect(page.locator('li').filter({ hasText: text }).first()).toBeVisible();
  await expect(page.locator('li').filter({ hasText: text })).toHaveCount(1);
}

// ── Bills ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('paying a bill from Jenius asks, and Record waits for the answer', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addBill(page, 'Rent', '6800000');
  // A wide screen's row opens the bill's side peek, where Pay is (a double-click would open its page).
  await page.getByTestId('bill-row').filter({ hasText: 'Rent' }).click();
  await page.getByTestId('bill-peek').getByRole('button', { name: 'Pay', exact: true }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay Rent' });
  await expect(sheet.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const record = sheet.getByRole('button', { name: 'Record payment' });
  await expect(record).toBeDisabled();
  // Enter in the amount is a submit too: it must not go round the question.
  await enterWaitsForTheQuestion(page, sheet.getByLabel('What it came to'));
  await expect(sheet).toBeVisible();
  await borrowFromEmergencyFund(sheet);
  await record.click();
  await expect(sheet).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
  await expectRecordedOnce(page, /Rent/);
});

test('paying several bills asks once for what they take together, spread over the bills in order', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  // Each fits the Rp 5.000.000 free on its own; together they are Rp 2.000.000 over.
  await addBill(page, 'Rent', '3000000');
  await addBill(page, 'School', '4000000');
  const sheet = await paySeveral(page, ['Rent', 'School']);
  await expect(sheet.getByText(/2\.000\.000 more than is free/)).toBeVisible();
  const record = sheet.getByRole('button', { name: 'Record 2 bills' });
  await expect(record).toBeDisabled();
  await borrowFromEmergencyFund(sheet);
  await record.click();
  await expect(sheet).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.2\.000\.000/i);
});

test('paying several bills with "Yes" counts the whole paid total against the goal, as one payment would', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addBill(page, 'Rent', '3000000');
  await addBill(page, 'School', '4000000');
  const sheet = await paySeveral(page, ['Rent', 'School']);
  await expect(sheet.getByText(/2\.000\.000 more than is free/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await sheet.getByRole('button', { name: 'Yes — this is what I saved for' }).click();
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toHaveCount(0);

  // 7.500.000 − (3.000.000 + 4.000.000) = 500.000 left promised. Spending only the bill that went over leaves 3.500.000.
  await page.goto('/goals');
  const umrah = await goalCard(page, 'Umrah 2027');
  await expect(umrah.getByTestId('goal-link').filter({ hasText: 'Jenius' })).toContainText(/Rp.500\.000/);
  await expect(umrah.getByText('Done', { exact: true })).toBeVisible();
  // And the free money is left free: 35.500.000 held − 30.500.000 promised = 5.000.000, as before the bills.
  await openAccountPage(page, 'Jenius');
  await expect(page.getByText(/^Rp.5\.000\.000$/).first()).toBeVisible();
  await expect(page.getByText(/^Rp.30\.500\.000$/).first()).toBeVisible();
});

// ── Loans ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addKpr(page: Page) {
  await openAccount(page, { subtype: 'loan', name: 'KPR Bintaro', balance: '700000000' });
  // The terms are written on the loan's own page; the list is how the loan is reached, and the page it ends on.
  // A loan is a row inside its kind's drawer, which the list opens shut.
  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
  await page.getByRole('button', { name: 'Add loan terms' }).click();
  // Some of these come filled in: each is cleared before it is typed.
  await retype(page, 'Lender', 'Bank BTN');
  await retype(page, /Amount borrowed/, '700000000');
  await retype(page, 'Rate a year (%)', '9');
  await page.getByLabel('First payment on').fill('2026-01-25');
  await retype(page, 'Tenor in months', '180');
  await retype(page, 'Payment day', '25');
  await page.getByRole('button', { name: 'Save terms' }).click();
  // Saving is a round trip; the schedule appearing is the write landing. See `addKpr` in loans.spec.ts.
  await expect(page.getByTestId('loan-card')).toBeVisible();
  // Debts lists a loan before it has terms, so its link alone does not say the save landed: its terms do.
  await page.goto('/net-worth/loans');
  // A loan is a row inside its kind's drawer, and the list opens with its drawers shut — the row is not drawn at
  // all until the drawer is, so the drawer comes first even for a read.
  await openDrawers(page);
  await expect(page.getByTestId(/^debt-row-/).filter({ hasText: 'KPR Bintaro' })).toContainText('Bank BTN');
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
}

async function retype(page: Page, label: string | RegExp, value: string) {
  const input = page.getByLabel(label, typeof label === 'string' ? { exact: true } : undefined);
  await input.clear();
  await input.pressSequentially(value);
}

test('a loan instalment of principal and interest asks about the whole of it', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addKpr(page);
  await page.getByRole('button', { name: 'Pay', exact: true }).click();
  // 5.000.000 principal + 1.800.000 interest: 1.800.000 over. Principal alone would ask nothing.
  await retype(page, 'Principal', '5000000');
  await retype(page, 'Interest', '1800000');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save payment' });
  await expect(save).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  await expect(save).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('an extra payment asks about the extra and the bank\'s penalty together', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addKpr(page);
  await page.getByRole('button', { name: 'Pay extra', exact: true }).click();
  // 6.000.000 + 800.000 penalty = 6.800.000 out of Jenius: 1.800.000 over (the extra alone is 1.000.000 over).
  await page.getByLabel(/How much/).pressSequentially('6000000');
  await page.getByRole('textbox', { name: /Penalty the bank charges/ }).pressSequentially('800000');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save extra payment' });
  await expect(save).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  await expect(save).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

// ── People ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('lending Andi 6.800.000 from Jenius asks', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await page.goto('/net-worth/lend-borrow');
  await page.getByRole('button', { name: 'Add to Lend & borrow' }).click();
  await page.getByRole('menuitem', { name: 'New receivable' }).click();
  await page.getByLabel(/^(Borrower|Lender)$/).pressSequentially('Andi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).pressSequentially('6800000');
  await page.getByLabel('Paid from').selectOption({ label: 'Jenius (IDR)' });
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  // Enter in a field submits the form: it must not go round the question.
  await enterWaitsForTheQuestion(page, page.getByLabel(/^(Borrower|Lender)$/));
  await expect(personRow(page, 'Andi')).toHaveCount(0);
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  await expect(personRow(page, 'Andi')).toBeVisible();

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
  await expectRecordedOnce(page, /Andi/, 'Jenius');
});

test('paying Budi back from Jenius asks; the loan came into another account', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addMoneyAccount(page, 'BCA', 'bank', '0');
  await page.goto('/net-worth/lend-borrow');
  await page.getByRole('button', { name: 'Add to Lend & borrow' }).click();
  await page.getByRole('menuitem', { name: 'New payable' }).click();
  await page.getByLabel(/^(Borrower|Lender)$/).pressSequentially('Budi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).pressSequentially('10000000');
  await page.getByLabel('Received into').selectOption({ label: 'BCA (IDR)' });
  // Money coming in asks nothing.
  await expect(page.getByText(/more than is free/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(personRow(page, 'Budi')).toBeVisible();

  await openLoan(page, 'Budi');
  await page.getByRole('button', { name: 'Record repayment' }).click();
  await page.getByRole('dialog').getByLabel('Paid back', { exact: true }).pressSequentially('6800000');
  await page.getByLabel('From').selectOption({ label: 'Jenius' });
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save repayment' });
  await expect(save).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  await expect(save).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

// ── Buys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addGold(page: Page) {
  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).pressSequentially('Antam gold bars');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-03-09');
  await page.getByLabel('How much').pressSequentially('10');
  await page.getByLabel('Total cost', { exact: true }).pressSequentially('18600000');
  // Paid from Opening Balances: nothing left Jenius, so nothing is asked.
  await expect(page.getByText(/more than is free/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The row is inside its kind's drawer, which the list opens shut.
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

async function buyGold(page: Page, grams: string, cost: string, goal: string | null) {
  // The gold's own Buy opens its sheet on its page; the goal is behind its "Add more details".
  const sheet = await openShortTrade(page, 'buy', 'Antam gold bars');
  await pickTradeCash(page, sheet, 'Payment method', 'Jenius');
  await sheet.getByLabel('Grams', { exact: true }).pressSequentially(grams);
  await sheet.getByLabel('Total paid', { exact: true }).pressSequentially(cost);
  if (goal) {
    await openTradeDetails(sheet);
    await chooseGoal(sheet, goal);
  }
}

test('adding a holding owned before never asks; buying gold from Jenius does', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addGold(page);
  await buyGold(page, '3', '6800000', null);
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const record = page.getByRole('button', { name: 'Record buy', exact: true });
  await expect(record).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await record.click();
  // The sheet closes on a saved trade only.
  await expect(shortTrade(page, 'buy')).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('gold bought for Umrah uses Umrah\'s own money first, and borrows only the rest', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addGold(page);
  // 13.000.000 − Umrah's own 7.500.000 − 5.000.000 free = 500.000 over.
  await buyGold(page, '6', '13000000', 'Umrah 2027');
  await expect(page.getByText(/500\.000 more than is free/)).toBeVisible();
  // Umrah is what the buy is for: it is not offered as a goal to take from, and a borrow is the only answer.
  await expect(page.getByRole('button', { name: 'Take from Umrah 2027' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await expect(page.getByRole('button', { name: /this is what I saved for/ })).toHaveCount(0);
  await recordShortTrade(page, 'buy');

  await expectShort(page, 'Emergency fund', /short by Rp.500\.000/i);
});

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('spending on an event from Jenius asks', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await page.goto('/events');
  await page.getByRole('button', { name: /^(New event|Add an event)$/ }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Lebaran');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Lebaran', exact: true })).toBeVisible();
  const eventUrl = page.url();

  // Add spending is the Add screen with the event set, so it asks the question the Add screen always asks.
  await page.getByRole('button', { name: 'Add spending', exact: true }).click();
  const form = addForm(page);
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, 'Jenius');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Food and beverage', exact: true }).click();
  await form.getByLabel('Note').pressSequentially('Hampers');
  await typeAmount(page, form, '6800000');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = saveButton(form);
  await expect(save).toBeDisabled();
  await enterWaitsForTheQuestion(page, form.getByLabel('Amount', { exact: true }));
  await expect(form.getByLabel('Note')).toHaveValue('Hampers');
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  // Saved, it is back on the event it was opened from.
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Lebaran', exact: true })).toBeVisible();

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
  // Event spending has left Cashflow's list: it is recorded once, and found in the event's own history.
  await page.goto(eventUrl);
  await expect(page.getByTestId('event-history').filter({ hasText: /Hampers/ })).toHaveCount(1);
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: /Hampers/ })).toHaveCount(0);
});

// ── The desktop's quick rows and the review queue ─────────────────────────────────────────────────────────────────

/** A recorded row of Cashflow's table (Mac Cashflow D: read only, under the typing row), by its note. */
const tableRow = (page: Page, description: string) => page.getByTestId('transaction-row').filter({ hasText: description });

async function typeRow(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').pressSequentially(description);
  await typing.getByLabel('Row amount (IDR)').pressSequentially(amount);
  for (const [label, text] of [['Row payment method', 'jenius'], ['Row category', 'groceries']] as const) {
    const cell = typing.getByLabel(label);
    // The cell waits (disabled) while the accounts and categories it offers are still loading; typing sooner is lost.
    await expect(cell).toBeEnabled();
    await cell.pressSequentially(text);
    await cell.press('Enter');
  }
  await typing.getByLabel('Row description').press('Enter');
  return typing;
}

test('a quick row that takes promised money asks in a sheet, and saves from it', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await typeRow(page, 'Laptop', '6800000');
  const sheet = page.getByRole('dialog', { name: 'Money set aside' });
  await expect(sheet.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = sheet.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  // Nothing is recorded while the question waits.
  await expect(tableRow(page, 'Laptop')).toHaveCount(0);
  await borrowFromEmergencyFund(sheet);
  await save.click();
  await expect(sheet).toHaveCount(0);
  await expect(tableRow(page, 'Laptop')).toHaveCount(1);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('a quick row within what is free saves in place, with no sheet', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await typeRow(page, 'Groceries', '3000000');
  await expect(tableRow(page, 'Groceries')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Money set aside' })).toHaveCount(0);
});

test('closing the sheet records nothing, and the typed row keeps what was typed', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  const typing = await typeRow(page, 'Laptop', '6800000');
  const sheet = page.getByRole('dialog', { name: 'Money set aside' });
  await expect(sheet.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(tableRow(page, 'Laptop')).toHaveCount(0);
  await expect(typing.getByLabel('Row amount (IDR)')).toHaveValue('6800000');
  await expect(typing.getByLabel('Row description')).toHaveValue('Laptop');
});

test('re-filing a borrowed row\'s category asks nothing and keeps the answer', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await typeRow(page, 'Laptop', '6800000');
  const sheet = page.getByRole('dialog', { name: 'Money set aside' });
  await borrowFromEmergencyFund(sheet);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toHaveCount(0);

  await page.getByRole('button', { name: 'Category for Laptop' }).click();
  await page.getByRole('dialog', { name: 'Category for Laptop' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(page.getByText('Moved to Restaurants')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Money set aside' })).toHaveCount(0);

  // Carried by the ledger: the borrow is still there, the same 1.800.000.
  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('confirming a draft that takes promised money asks in the same sheet', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await page.goto('/import');
  await page.getByLabel('Into account').selectOption({ label: 'Jenius (IDR)' });
  const csv = ['Date,Description,Amount', '09/09/2026,LAPTOP STORE,-6800000'].join('\n');
  await page.locator('input[type="file"]').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByRole('button', { name: /Send \d+ to review/ }).click();
  await expect(page.getByText(/Nothing is recorded until confirmed there/)).toBeVisible();

  await page.goto('/review');
  await pickDraftCategory(page, 'LAPTOP STORE', 'Groceries');
  await page.getByRole('button', { name: 'Record LAPTOP STORE' }).click();
  const sheet = page.getByRole('dialog', { name: 'Money set aside' });
  await expect(sheet.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  // Closing it records nothing: the draft still waits.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Record LAPTOP STORE' }).click();
  await borrowFromEmergencyFund(sheet);
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('draft-row')).toHaveCount(0);

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});
