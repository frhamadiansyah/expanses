import { expect, type Page, test } from '@playwright/test';
import { openLoan, personRow } from './people';
import { openAccount } from './accounts';
import { closeDetails, shareWith } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** The label the old inline form used went with it; the kind decides what the picker asks for now. */
async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await openAccount(page, { subtype: type, name, balance: amount });
}

/**
 * + on the desktop asks which side, because both columns are in front of you; each side then adds on a screen
 * of its own, New receivable or New payable, and Save comes back to Lend & borrow.
 */
async function openNew(page: Page, side: 'New receivable' | 'New payable') {
  await page.getByRole('button', { name: 'Add to Lend & borrow' }).click();
  await page.getByRole('menuitem', { name: side }).click();
  await expect(page.getByRole('heading', { name: side })).toBeVisible();
}

async function lend(page: Page, person: string, amount: string, from: string) {
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill(person);
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).fill(amount);
  await page.getByLabel('Paid from').selectOption({ label: from });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(personRow(page, person)).toBeVisible();
}

test('lending on a credit card raises the card, earns points, and is never spending', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '0');

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).fill('4000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA KrisFlyer (IDR)' });
  await page.getByLabel('Category for points').selectOption({ label: 'Shopping (general)' });
  await page.getByLabel('MCC').fill('5311');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(personRow(page, 'Andi')).toBeVisible();
  await expect(page.getByText(/4\.000\.000/).first()).toBeVisible();

  // The bank never moved, the card owes it, and net worth is unchanged: a loan is not spending.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('50.000.000');
  // What Andi owes is money owed to you, and the sheet draws it in the picker's own category: a section of its own as
  // Receivables, folded by the sub-category the loan files as — 0201, trade receivables. The card is a kind of debt on
  // the other side. The sheet folds twice now — a section, then the kinds inside it — so the section is opened first.
  await page.getByTestId('type-drawer-section-receivable').click();
  await expect(page.getByTestId('type-drawer-receivable:trade_receivable')).toContainText('Trade receivables');
  await expect(page.getByTestId('type-drawer-debts:credit_card')).toContainText('Credit card');

  // Spending stays empty, because no expense category was touched. `/spending` is the transactions list now, and
  // the report there says it in its own words. The assertion used to be the *absence* of the amount anywhere on the
  // page, which passed whenever the list had not finished loading and never tested the thing it claimed.
  await page.goto('/spending');
  await expect(page.getByText(/^Nothing recorded for /)).toBeVisible();
  await expect(page.getByTestId('period-total')).toHaveText(/Rp\s?0$/);
});

test('records a repayment and the balance falls', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '10000000', 'BCA Tahapan (IDR)');

  // Repaying is done on the loan's own page: Andi's row, then his loan.
  await openLoan(page, 'Andi');
  await page.getByRole('button', { name: 'Record collection' }).click();
  await page.getByLabel(/^Came back/).fill('4000000');
  await page.getByRole('button', { name: 'Save collection' }).click();

  await expect(page.getByText(/6\.000\.000/).first()).toBeVisible();
});

test('a repayment opens in a sheet over the loan, and closes without saving', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '9000000', 'BCA Tahapan (IDR)');

  await openLoan(page, 'Andi');
  // Recording it is the first row of History, over the entries it adds to; forgiving is a red row at the foot.
  const record = page.getByRole('button', { name: 'Record collection' });
  expect((await page.getByText('History', { exact: true }).boundingBox())!.y).toBeLessThan((await record.boundingBox())!.y);
  expect((await record.boundingBox())!.y).toBeLessThan((await page.getByRole('button', { name: 'Forgive the rest' }).boundingBox())!.y);
  await record.click();
  const sheet = page.getByRole('dialog', { name: 'Collection' });
  await expect(sheet).toBeVisible();
  // The loan stays under it, and ✓ waits for an amount.
  await expect(page.getByTestId('loan-hero')).toBeAttached();
  await expect(sheet.getByRole('button', { name: 'Save collection' })).toBeDisabled();

  // ✕ throws the typed amount away.
  await sheet.getByLabel(/^Came back/).fill('4500000');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('loan-hero')).toContainText('9.000.000');
  // The top is the amount alone; what was lent and what came back are rows in Details.
  await expect(page.getByTestId('loan-hero')).not.toContainText(/lent|back/);
  await expect(page.getByRole('textbox', { name: 'Money lent', exact: true })).toHaveValue(/9\.000\.000/);
  await expect(page.getByRole('textbox', { name: 'Money back', exact: true })).toHaveValue(/Rp\s?0$/);

  // ✓ saves the whole of it, and the loan is paid off.
  await page.getByRole('button', { name: 'Record collection' }).click();
  await sheet.getByLabel(/^Came back/).fill('9000000');
  await sheet.getByRole('button', { name: 'Save collection' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Record collection' })).toHaveCount(0);
  // Money back on a loan you made is a collection, in the history too.
  await expect(page.getByText('Collection', { exact: true })).toBeVisible();
  await expect(page.getByText('Repayment', { exact: true })).toHaveCount(0);
});

test('refuses a repayment bigger than the debt, by name', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '9000000', 'BCA Tahapan (IDR)');

  await openLoan(page, 'Andi');
  await page.getByRole('button', { name: 'Record collection' }).click();
  await page.getByLabel(/^Came back/).fill('12000000');
  await page.getByRole('button', { name: 'Save collection' }).click();

  await expect(page.getByText(/Andi owes Rp\s?9\.000\.000/)).toBeVisible();
});

test('forgiving the rest closes the debt and takes it off the balance sheet', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '10000000', 'BCA Tahapan (IDR)');

  await openLoan(page, 'Andi');
  await page.getByRole('button', { name: 'Forgive the rest' }).click();
  // The loan closes on its own page, and Andi moves under Show settled on the list.
  await expect(page.getByRole('button', { name: 'Forgive the rest' })).toHaveCount(0);
  await page.goto('/net-worth/lend-borrow');
  await expect(page.getByRole('button', { name: /Show settled/ })).toBeVisible();

  // The money is gone from cash and no longer owed to anyone: net worth carries the loss once.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('40.000.000');
});

test('splits a bill: your share is spending, your friend owes theirs', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('button', { name: 'Paid with' }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Tahapan', exact: true }).click();
  await form.getByLabel('Amount', { exact: true }).fill('900000');
  await form.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Dinner at Plataran');
  // With, under Add more details: the row that replaced the card's single-person checkbox.
  const { more, sheet } = await shareWith(page, form, [{ name: 'Andi', owes: '600000' }]);
  await closeDetails(more, sheet);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await expect(page.getByText('Dinner at Plataran')).toBeVisible();

  // Andi owes his part, and only your own share reached the category.
  await page.goto('/net-worth/lend-borrow');
  await expect(personRow(page, 'Andi')).toBeVisible();
  await expect(page.getByText(/600\.000/).first()).toBeVisible();

  await page.goto('/spending');
  await expect(page.getByText(/300\.000/).first()).toBeVisible();
});

/** The other direction: money taken from a person, which lands under "Payables". */
async function borrow(page: Page, person: string, amount: string, into: string) {
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New payable');
  await page.getByLabel('Person').fill(person);
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).fill(amount);
  await page.getByLabel('Received into').selectOption({ label: into });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(personRow(page, person)).toBeVisible();
}

test('the desktop keeps both sides in front of you, side by side', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '1000000', 'BCA Tahapan (IDR)');
  await borrow(page, 'Dewi', '750000', 'BCA Tahapan (IDR)');

  await page.goto('/net-worth/lend-borrow');
  // Both group headers, both figures and both people at once: the phone's one-list-at-a-time control is not here,
  // so nothing the desktop could see before this is behind a tap now.
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Receivables', 'Payables']);
  await expect(page.getByRole('radiogroup', { name: 'Lend & borrow' })).toHaveCount(0);
  await expect(personRow(page, 'Andi')).toBeVisible();
  await expect(personRow(page, 'Dewi')).toBeVisible();
  await expect(page.getByTestId('debts-total-Receivables')).toHaveText('Rp 1.000.000');
  await expect(page.getByTestId('debts-total-Payables')).toHaveText('Rp 750.000');
});

/**
 * A dollar account holding nothing yet: an empty opening asks no rate, so none is stored before the loan.
 * The rate server is cut off too, so the form can only get the dollar's rate by asking for it.
 */
async function emptyDollarAccount(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD' });
}

test('lends US$100 with no dollar rate stored: the form asks for it and the loan records', async ({ page }) => {
  await emptyDollarAccount(page);

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'Wise USD (USD)' });
  await page.getByLabel('Money lent (USD)').fill('100');
  await page.getByLabel('Rate: IDR per 1 USD').fill('16250');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(personRow(page, 'Andi')).toBeVisible();
  await expect(page.getByText(/No USD.IDR rate/)).toHaveCount(0);
  // Printed in dollars on their card, and converted at the typed rate in the side's total.
  await expect(page.getByText(/US\$\s?100/).first()).toBeVisible();
  await expect(page.getByTestId('debts-total-Receivables')).toContainText('1.625.000');
});

test('borrows US$50 with no dollar rate stored: the form asks for it and the debt records', async ({ page }) => {
  await emptyDollarAccount(page);

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New payable');
  await page.getByLabel('Person').fill('Budi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Received into').selectOption({ label: 'Wise USD (USD)' });
  await page.getByLabel('Money borrowed (USD)').fill('50');
  // Saved blank first: with no rate stored and none to fetch, it says so and waits for one — nothing is lost.
  await page.getByLabel('Rate: IDR per 1 USD').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/No USD.IDR rate/)).toBeVisible();
  await page.getByLabel('Rate: IDR per 1 USD').fill('16000');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(personRow(page, 'Budi')).toBeVisible();
  await expect(page.getByText(/US\$\s?50/).first()).toBeVisible();
  await expect(page.getByTestId('debts-total-Payables')).toContainText('800.000');
});

test('+ asks which side, each opens on a screen of its own, and back and Save both return to Lend & borrow', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await page.goto('/net-worth/lend-borrow');

  // Both choices are under the one +, because the desktop shows both sides at once.
  await page.getByRole('button', { name: 'Add to Lend & borrow' }).click();
  await expect(page.getByRole('menuitem', { name: 'New receivable' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'New payable' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'New payable' }).click();

  // A screen of its own, not a form above the lists, and it asks no direction: the title already said it.
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\/new-payable/);
  await expect(page.getByRole('heading', { name: 'New payable' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /I (lent|borrowed) money/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(page.getByLabel('Received into')).toBeVisible();

  // Back goes to Lend & borrow and records nothing.
  await page.getByRole('link', { name: /Lend & borrow/ }).first().click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow(\?|$)/);
  await expect(page.getByText('Nothing lent or borrowed yet.', { exact: false })).toBeVisible();

  // Save does too, with the new person on the side they were added to.
  await openNew(page, 'New payable');
  await page.getByLabel('Person').fill('Dewi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel(/^Money (lent|borrowed)/).fill('750000');
  await page.getByLabel('Received into').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?.*side=owe/);
  await expect(personRow(page, 'Dewi')).toBeVisible();
  await expect(page.getByTestId('debts-total-Payables')).toContainText('750.000');
});

test('a second loan to the same person is a loan of its own, and typing or picking one of theirs adds to it', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByRole('textbox', { name: 'Loan', exact: true }).fill('Motorcycle repair');
  await page.getByLabel(/^Money (lent|borrowed)/).fill('1500000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(personRow(page, 'Andi')).toBeVisible();

  // The same name, a new purpose: a loan of its own. His open loans are not offered until something is typed.
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  const loan = page.getByRole('textbox', { name: 'Loan', exact: true });
  await expect(page.getByRole('button', { name: /^Motorcycle repair · / })).toHaveCount(0);
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await loan.fill('Laptop purchase');
  await page.getByLabel(/^Money (lent|borrowed)/).fill('8000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // One row for Andi on the list; his page tells the two loans apart by their reasons.
  await expect(personRow(page, 'Andi')).toHaveCount(1);
  await expect(page.getByTestId('debts-total-Receivables')).toContainText('9.500.000');
  await personRow(page, 'Andi').click();
  await expect(page.getByTestId('loan-row').filter({ hasText: 'Motorcycle repair' })).toBeVisible();
  await expect(page.getByTestId('loan-row').filter({ hasText: 'Laptop purchase' })).toBeVisible();

  // Typing part of a reason offers that loan as a chip; picking it adds to it, and its sub category is the loan's.
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await loan.fill('lap');
  await page.getByRole('button', { name: /^Laptop purchase · .*8\.000\.000 left$/ }).click();
  await expect(loan).toHaveValue('Laptop purchase');
  await expect(page.getByText(/^Adds to this open loan/)).toBeVisible();
  await expect(page.getByLabel('Type', { exact: true })).toBeDisabled();
  await page.getByLabel(/^Money (lent|borrowed)/).fill('500000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('debts-total-Receivables')).toContainText('10.000.000');

  // Typing the whole reason does the same, without the chip.
  await openNew(page, 'New receivable');
  await page.getByLabel('Person').fill('Andi');
  await loan.fill('motorcycle repair');
  await expect(page.getByText(/^Adds to this open loan/)).toBeVisible();
  await page.getByLabel(/^Money (lent|borrowed)/).fill('100000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Still two loans: the money went onto them, not into new ones.
  await personRow(page, 'Andi').click();
  await expect(page.getByTestId('loan-row')).toHaveCount(2);
  await expect(page.getByTestId('loan-row').filter({ hasText: 'Laptop purchase' })).toContainText('8.500.000');
  await expect(page.getByTestId('loan-row').filter({ hasText: 'Motorcycle repair' })).toContainText('1.600.000');
});

test('the box asks in order, the ✓ waits for a sub category, and the rest folds behind Add more details', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');

  // Type, Person, Money lent, Paid from, Loan, Date — in that order, with no fee until the details open.
  const labels = await page.locator('form label').allInnerTexts();
  expect(labels.some((text) => text.trim().startsWith('Fee'))).toBe(false);
  const order = ['Type', 'Person', 'Money lent', 'Paid from', 'Loan', 'Date'].map((name) =>
    labels.findIndex((text) => text.trim().startsWith(name)),
  );
  expect(order).toEqual([...order].sort((x, y) => x - y));
  expect(order).not.toContain(-1);

  // Type starts blank and holds the ✓ back until one is chosen.
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('');
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel(/^Money (lent|borrowed)/).fill('8000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(save).toBeDisabled();
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await expect(save).toBeEnabled();

  // Folded: the box ends at the date, and the toggle under it says what it does.
  await expect(page.getByRole('textbox', { name: 'Due by' })).toHaveCount(0);
  const toggle = page.getByRole('button', { name: 'Add more details' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(page.getByRole('textbox', { name: 'Due by' })).toBeVisible();
  // The fee sits under the due date.
  const opened = await page.locator('form label').allInnerTexts();
  expect(opened.findIndex((text) => text.trim().startsWith('Fee'))).toBeGreaterThan(opened.findIndex((text) => text.trim() === 'Due by'));
  await expect(page.getByRole('textbox', { name: 'Tax ID', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Due by' }).fill('2026-12-31');
  await page.getByRole('button', { name: 'Fewer details' }).click();
  await expect(page.getByRole('textbox', { name: 'Due by' })).toHaveCount(0);

  // Folding keeps what was typed: it is saved with the loan.
  await save.click();
  await personRow(page, 'Andi').click();
  await expect(page.getByTestId('loan-row')).toContainText(/Due|overdue/i);
});

test('a loan is changed on its own page, and a person’s tax ID on theirs', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '5000000', 'BCA Tahapan (IDR)');

  // Written once at lending with no reason; added afterwards on the loan's page, where it used to be impossible.
  await openLoan(page, 'Andi');
  // The bar says only Loan; whose it is sits in Details, shown but not changed.
  await expect(page.getByRole('heading', { name: 'Loan', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Person', exact: true })).toHaveValue('Andi');
  await expect(page.getByRole('textbox', { name: 'Person', exact: true })).not.toBeEditable();
  await expect(page.getByText(/still owes/)).toHaveCount(0);
  const reason = page.getByRole('textbox', { name: 'Loan', exact: true });
  await reason.fill('Laptop for college');
  await reason.blur();
  await expect(reason).toHaveValue('Laptop for college');
  await page.getByRole('textbox', { name: 'Due by' }).fill('2026-12-31');
  await page.getByLabel('Type', { exact: true }).selectOption({ label: 'Affiliate receivables' });

  // The person's page reads it back: the new reason, in English, with the sub-category it now files as.
  await page.getByRole('link', { name: /Andi/ }).first().click();
  const loan = page.getByTestId('loan-row').filter({ hasText: 'Laptop for college' });
  await expect(loan).toContainText('Affiliate receivables');
  await expect(loan).not.toContainText(/Piutang/);

  // A tax ID is the person's, set once for all their loans.
  const taxId = page.getByRole('textbox', { name: 'Tax ID', exact: true });
  await taxId.fill('3173010101900001');
  await taxId.blur();
  // Away and back inside the app, as a person would: a reload straight after the blur could cut the save short.
  await page.getByRole('link', { name: /Lend & borrow/ }).first().click();
  await personRow(page, 'Andi').click();
  await expect(page.getByRole('textbox', { name: 'Tax ID', exact: true })).toHaveValue('3173010101900001');

  // And the list is one row: the name and the figure, with no second line when nothing is due.
  await page.goto('/net-worth/lend-borrow');
  await expect(personRow(page, 'Andi')).toHaveCount(1);
  await expect(personRow(page, 'Andi')).not.toContainText('Laptop for college');
  await expect(page.getByText(/^Lending is not spending/)).toHaveCount(0);
});

test('the figures name a currency only once an account decides it', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD' });
  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByRole('button', { name: 'Add more details' }).click();
  // Nothing picked yet: no code to guess at, and the empty fields say only what goes in them.
  await expect(page.getByRole('textbox', { name: 'Money lent', exact: true })).toHaveAttribute('placeholder', 'Amount');
  await expect(page.getByRole('textbox', { name: 'Fee', exact: true })).toHaveAttribute('placeholder', 'Amount');
  await page.getByLabel('Paid from').selectOption({ label: 'Wise USD (USD)' });
  await expect(page.getByRole('textbox', { name: 'Money lent (USD)', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Fee (USD)', exact: true })).toBeVisible();
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await expect(page.getByRole('textbox', { name: 'Money lent (IDR)', exact: true })).toBeVisible();
});

test('a person\'s initial turns red when a loan is overdue, and stays grey with no date', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Budi', '1000000', 'BCA Tahapan (IDR)');

  await page.goto('/net-worth/lend-borrow');
  await openNew(page, 'New receivable');
  await page.getByLabel('Type', { exact: true }).selectOption({ index: 1 });
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel(/^Money (lent|borrowed)/).fill('2000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByRole('button', { name: 'Add more details' }).click();
  await page.getByRole('textbox', { name: 'Due by' }).fill('2026-01-01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  const initial = (name: string) => personRow(page, name).locator('span.rounded-full[aria-hidden]').first();
  await expect(initial('Andi')).toHaveAttribute('style', /--ph-alarm/);
  await expect(initial('Budi')).toHaveAttribute('style', /--ph-fill/);
  // The colour says it; the row carries no second line.
  await expect(personRow(page, 'Andi')).not.toContainText(/overdue|Due/i);
});
