import { expect, type Locator, type Page, test } from '@playwright/test';
import { addBill, addMoneyAccount, goalCard, jeniusWithTwoGoals, openAccountPage, openExpense, typeAmount } from './set-aside';

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
  await page.goto('/goals');
  // The card says it twice since Task 13 — under the figure and on the Funded-by row — and both carry the same figure.
  await expect(goalCard(page, goal).getByText(figure).first()).toBeVisible();
}

/** Answers the question in `scope`: the Emergency fund, borrowing. */
async function borrowFromEmergencyFund(scope: ReturnType<Page['locator']>) {
  await scope.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await scope.getByRole('button', { name: 'No — borrowing from it' }).click();
}

// ── Cards ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addCard(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially('BCA Visa');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').pressSequentially('31');
  await page.getByLabel('Due date').pressSequentially('15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByRole('radio', { name: 'Activity' }).click();
  await expect(page.getByText('Statements')).toBeVisible();
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

async function openCard(page: Page) {
  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
}

test('paying the card bill from Jenius asks, and the Emergency fund lends the 1.800.000', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addCard(page);
  await buyOnCard(page, 'Laptop', '6800000', LAST_MONTH);
  await openCard(page);

  const tile = page.getByTestId('tile-left-to-pay');
  // Opened from the Wallet stack, the Unpaid tile's own Pay opens the payment form inside the tile.
  await tile.getByRole('button', { name: 'Pay', exact: true }).click();
  await expect(tile.getByLabel('Amount (IDR)')).toHaveValue('6800000');
  await expect(tile.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(tile.getByRole('button', { name: 'Record payment' })).toBeDisabled();
  await borrowFromEmergencyFund(tile);
  await tile.getByRole('button', { name: 'Record payment' }).click();
  await expect(tile).toContainText('Paid in full');

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
});

test('paying chosen purchases now from Jenius asks the same question', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addCard(page);
  await buyOnCard(page, 'Laptop', '6800000', TODAY);
  await openCard(page);

  await page.getByLabel('Pay Laptop').check();
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const pay = page.getByRole('button', { name: /^Pay Rp/ });
  await expect(pay).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await pay.click();
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

async function expectRecordedOnce(page: Page, text: RegExp) {
  await page.goto('/transactions');
  await expect(page.locator('li').filter({ hasText: text }).first()).toBeVisible();
  await expect(page.locator('li').filter({ hasText: text })).toHaveCount(1);
}

// ── Bills ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('paying a bill from Jenius asks, and Record waits for the answer', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addBill(page, 'Rent', '6800000');
  await page.getByTestId('bill-row').filter({ hasText: 'Rent' }).click();
  await page.getByRole('button', { name: /^Pay \w+ bill$/ }).click();

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
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Rent' }).click();
  await page.getByRole('checkbox', { name: 'Select School' }).click();
  await page.getByRole('button', { name: /^Pay 2 selected/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay several' });
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
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Rent' }).click();
  await page.getByRole('checkbox', { name: 'Select School' }).click();
  await page.getByRole('button', { name: /^Pay 2 selected/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await expect(sheet.getByText(/2\.000\.000 more than is free/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Take from Umrah 2027' }).click();
  await sheet.getByRole('button', { name: 'Yes — this is what I saved for' }).click();
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toHaveCount(0);

  // 7.500.000 − (3.000.000 + 4.000.000) = 500.000 left promised. Spending only the bill that went over leaves 3.500.000.
  await page.goto('/goals');
  await expect(goalCard(page, 'Umrah 2027').getByTestId('goal-link').filter({ hasText: 'Jenius' })).toContainText(/Rp.500\.000/);
  await expect(goalCard(page, 'Umrah 2027').getByText('Done', { exact: true })).toBeVisible();
  // And the free money is left free: 35.500.000 held − 30.500.000 promised = 5.000.000, as before the bills.
  await openAccountPage(page, 'Jenius');
  await expect(page.getByText(/^Rp.5\.000\.000$/).first()).toBeVisible();
  await expect(page.getByText(/^Rp.30\.500\.000$/).first()).toBeVisible();
});

// ── Loans ─────────────────────────────────────────────────────────────────────────────────────────────────────────

async function addKpr(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).pressSequentially('KPR Bintaro');
  await page.getByLabel('Type').selectOption('loan');
  await page.getByLabel('Amount owed now').pressSequentially('700000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'KPR Bintaro', exact: true })).toBeVisible();
  // The terms are written on the loan's own page; the list is how the loan is reached, and the page it ends on.
  await page.goto('/net-worth/loans');
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
  await expect(page.getByText('Where this loan stands')).toBeVisible();
  // Debts lists a loan before it has terms, so its link alone does not say the save landed: its terms do.
  await page.goto('/net-worth/loans');
  await expect(page.getByRole('row', { name: /KPR Bintaro/ })).toContainText('Bank BTN');
  await page.getByRole('link', { name: 'KPR Bintaro' }).click();
}

async function retype(page: Page, label: string | RegExp, value: string) {
  const input = page.getByLabel(label);
  await input.clear();
  await input.pressSequentially(value);
}

test('a loan instalment of principal and interest asks about the whole of it', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addKpr(page);
  await page.getByRole('button', { name: 'Record payment' }).click();
  // 5.000.000 principal + 1.800.000 interest: 1.800.000 over. Principal alone would ask nothing.
  await retype(page, 'Principal (IDR)', '5000000');
  await retype(page, 'Interest (IDR)', '1800000');
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
  await page.getByRole('button', { name: 'Extra payment' }).click();
  // 6.000.000 + 800.000 penalty = 6.800.000 out of Jenius: 1.800.000 over (the extra alone is 1.000.000 over).
  await page.getByLabel(/How much/).pressSequentially('6000000');
  await page.getByLabel(/Penalty the bank charges/).pressSequentially('800000');
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
  await page.getByRole('button', { name: 'Add a loan' }).click();
  await page.getByLabel('Person').pressSequentially('Andi');
  await page.getByLabel(/^Amount/).pressSequentially('6800000');
  await page.getByLabel('Paid from').selectOption({ label: 'Jenius (IDR)' });
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  // Enter in a field submits the form: it must not go round the question.
  await enterWaitsForTheQuestion(page, page.getByLabel('Person'));
  await expect(page.getByRole('heading', { name: 'Andi' })).toHaveCount(0);
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
  await expectRecordedOnce(page, /Andi/);
});

test('paying Budi back from Jenius asks; the loan came into another account', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addMoneyAccount(page, 'BCA', 'bank', '0');
  await page.goto('/net-worth/lend-borrow');
  await page.getByRole('button', { name: 'Add a loan' }).click();
  await page.getByRole('radio', { name: 'I borrowed money' }).click();
  await page.getByLabel('Person').pressSequentially('Budi');
  await page.getByLabel(/^Amount/).pressSequentially('10000000');
  await page.getByLabel('Received into').selectOption({ label: 'BCA (IDR)' });
  // Money coming in asks nothing.
  await expect(page.getByText(/more than is free/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Budi' })).toBeVisible();

  await page.getByRole('button', { name: 'Record repayment' }).click();
  await page.getByLabel(/How much you paid/).pressSequentially('6800000');
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
  await page.goto('/net-worth/assets');
  await page.getByRole('button', { name: 'Add asset' }).click();
  await page.getByLabel('What is it?').selectOption('gold');
  await page.getByLabel('Name', { exact: true }).pressSequentially('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').pressSequentially('10');
  await page.getByLabel('Total cost (IDR)').pressSequentially('18600000');
  // Paid from Opening Balances: nothing left Jenius, so nothing is asked.
  await expect(page.getByText(/more than is free/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();
}

async function buyGold(page: Page, grams: string, cost: string, goal: string | null) {
  await page.goto('/net-worth/trades');
  await page.getByLabel('Money account').selectOption({ label: 'Jenius' });
  await page.getByLabel('Units, shares or grams').pressSequentially(grams);
  await page.getByLabel(/What it cost, before fees/).pressSequentially(cost);
  if (goal) await page.getByLabel('For goal').selectOption({ label: goal });
}

test('adding a holding owned before never asks; buying gold from Jenius does', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await addGold(page);
  await buyGold(page, '3', '6800000', null);
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const record = page.getByRole('button', { name: 'Record', exact: true });
  await expect(record).toBeDisabled();
  await borrowFromEmergencyFund(page.locator('body'));
  await record.click();
  await expect(page.getByText(/^Recorded/)).toBeVisible();

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
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText(/^Recorded/)).toBeVisible();

  await expectShort(page, 'Emergency fund', /short by Rp.500\.000/i);
});

// ── Events ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('spending on an event from Jenius asks', async ({ page }) => {
  await jeniusWithTwoGoals(page);
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).pressSequentially('Lebaran');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Lebaran', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add spending' }).click();
  await page.getByLabel('Description').pressSequentially('Hampers');
  await page.getByLabel('Paid with').selectOption({ label: 'Jenius (IDR)' });
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Food and beverage' });
  await page.getByLabel('Amount', { exact: true }).pressSequentially('6800000');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await enterWaitsForTheQuestion(page, page.getByLabel('Amount', { exact: true }));
  await expect(page.getByLabel('Description')).toHaveValue('Hampers');
  await borrowFromEmergencyFund(page.locator('body'));
  await save.click();
  await expect(page.getByLabel('Description')).toHaveValue('');

  await expectShort(page, 'Emergency fund', /short by Rp.1\.800\.000/i);
  await expectRecordedOnce(page, /Hampers/);
});

// ── The desktop's quick rows and the review queue ─────────────────────────────────────────────────────────────────

/** A recorded row of the table, by what its description cell holds (the opening balance is a row too). */
const tableRow = (page: Page, description: string) =>
  page.getByTestId('table-row').filter({ has: page.locator(`input[aria-label="Row description"][value="${description}"]`) });

async function typeRow(page: Page, description: string, amount: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Table' }).click();
  const typing = page.getByTestId('typing-row');
  await typing.getByLabel('Row description').pressSequentially(description);
  await typing.getByLabel('Row amount (IDR)').pressSequentially(amount);
  for (const [label, text] of [['Row paid with', 'jenius'], ['Row category', 'groceries']] as const) {
    const cell = typing.getByLabel(label);
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

  await page.getByRole('button', { name: 'List' }).click();
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
  await expect(page.getByText(/Nothing is recorded until you confirm it there/)).toBeVisible();

  await page.goto('/review');
  await page.getByLabel('Category for LAPTOP STORE').selectOption({ label: 'Groceries' });
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
