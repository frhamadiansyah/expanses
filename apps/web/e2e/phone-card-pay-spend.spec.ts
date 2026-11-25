import { expect, type Locator, type Page, test } from '@playwright/test';
import { jeniusWithTwoGoals } from './set-aside';
import { expectWalletFigure, openAccount, openAccountHistory, openCard, walletCard } from './accounts';
import { addForm, addTransaction, addTransfer, fillAmount, openAmount, saveButton } from './add-transaction';
import { cardPage, chooseCardPayFrom, openCardPay, openStatementPay, saveCardTerms, showCardBack } from './card-section';
import { localIsoDate } from './today';

/*
 * A credit card's round Pay and Spend open the ordinary Add screen, each locked to one job (owner, 17 Nov 2026):
 * Pay in the Transfer layout titled "Pay credit card", Spend in the Expense layout titled "New expense". No tabs, and
 * never the card's name in a title. Invented names and figures.
 */

const now = new Date();
/** The 15th of last month: with a statement on the last day, always on the previous statement. */
const LAST_MONTH = localIsoDate(new Date(now.getFullYear(), now.getMonth() - 1, 15));

async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await cardPage(page, 'Settings');
  // The 31st is clamped to each month's last day, so today is always inside the current statement.
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Hotel stay', paidWith: 'BCA Visa', category: 'Groceries', amount: '3000000', date: LAST_MONTH, paidOff: false });
}

async function openCardPage(page: Page) {
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await expect(page).toHaveURL(/\/cards\/[^/?]+$/);
}

test('Pay opens “Pay credit card”: From to choose, To fixed on the card, the bill and the note filled in; it pays the statement', async ({ page }) => {
  await setUp(page);
  await openCardPage(page);
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('3.000.000');

  const form = await openCardPay(page);
  // One job: no Expense / Income / Transfer tabs, and the card's name in no title.
  await expect(form.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /BCA Visa/ })).toHaveCount(0);
  // From is empty and Save waits for it.
  await expect(form.getByRole('button', { name: 'From' })).toBeVisible();
  await expect(form.getByRole('button', { name: 'From' })).not.toContainText('BCA Tahapan');
  await expect(saveButton(form)).toBeDisabled();
  // To is the card, read and never changed: a row, not a button.
  await expect(form.getByTestId('pay-card-to')).toContainText('BCA Visa');
  await expect(form.getByTestId('pay-card-to')).toContainText('To');
  await expect(form.getByRole('button', { name: /^To/ })).toHaveCount(0);
  await expect(form.getByTestId('pay-card-to').getByRole('button')).toHaveCount(0);
  // The bill filled in, and the note.
  await expect(form).toContainText('3.000.000');
  await expect(form.getByLabel('Note')).toHaveValue('Credit card payment');
  // Add more details: Photos, but no Exclude from report — a card payment never counts in Cashflow anyway.
  await form.getByRole('button', { name: 'Add more details' }).click();
  const more = form.getByRole('region', { name: 'More details' });
  await expect(more.getByRole('button', { name: /^Photos/ })).toBeVisible();
  await expect(more.getByText('Exclude from report')).toHaveCount(0);

  // BCA Tahapan pays it: the card owes nothing, the statement says paid, and the bank holds Rp 3.000.000 less.
  await chooseCardPayFrom(form, 'BCA Tahapan');
  await expect(saveButton(form)).toBeEnabled();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/cards\/[^/?]+$/);
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Paid in full');
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('0');

  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-group')).toContainText(/All paid/i);

  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '17.000.000');

  // Edited later, the payment opens as “Edit payment”, in the Pay layout: no tabs, the card its To and fixed.
  await openAccountHistory(page, 'BCA Tahapan');
  await page.getByText('Credit card payment').first().click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Edit payment', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /BCA Visa/ })).toHaveCount(0);
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  await expect(edit.getByRole('radio')).toHaveCount(0);
  await expect(edit.getByTestId('pay-card-to')).toContainText('BCA Visa');
  await expect(edit.getByTestId('pay-card-to').getByRole('button')).toHaveCount(0);
  await expect(edit.getByRole('button', { name: /^To/ })).toHaveCount(0);
  await expect(edit.getByRole('button', { name: 'From' })).toContainText('BCA Tahapan');
  await edit.getByRole('button', { name: 'Add more details' }).click();
  await expect(edit.getByRole('region', { name: 'More details' }).getByText('Exclude from report')).toHaveCount(0);
  // A smaller payment, and a note of its own.
  await edit.getByLabel('Note').fill('Visa bill paid');
  await edit.getByRole('button', { name: 'Clear amount' }).click();
  await openAmount(edit);
  await fillAmount(page, edit, '2000000');
  await saveButton(edit).click();
  await expect(page.getByRole('heading', { name: 'Edit payment', exact: true })).toHaveCount(0);
  await openAccountHistory(page, 'BCA Tahapan');
  await expect(page.getByText('Visa bill paid').first()).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '18.000.000');
  await openCardPage(page);
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('1.000.000');
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Hotel stay' })).toContainText(/Rp\s1\.000\.000 left/);
});

test('a transfer between two own accounts still edits on “Edit transaction”, with its tabs and a To to change', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openAccount(page, { subtype: 'bank', name: 'Mandiri', balance: '0' });
  await page.goto('/transactions');
  await addTransfer(page, { from: 'BCA Tahapan', to: 'Mandiri', amount: '500000', note: 'Moved over' });
  await openAccountHistory(page, 'BCA Tahapan');
  await page.getByText('Moved over').first().click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Edit transaction', exact: true })).toBeVisible();
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  await expect(edit.getByRole('radio')).toHaveCount(3);
  await expect(edit.getByRole('button', { name: /^To/ })).toContainText('Mandiri');
  await expect(edit.getByTestId('pay-card-to')).toHaveCount(0);
});

test('Spend opens “New expense” on the card: no tabs, Paid with the card', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa' });
  await openCardPage(page);
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Spend', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New expense', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /BCA Visa/ })).toHaveCount(0);
  const form = addForm(page);
  await expect(form.getByRole('radio')).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Payment method/ })).toContainText('BCA Visa');
  await expect(form.getByRole('button', { name: /^Category/ })).toBeVisible();
});

test('the Debt-free plan’s Pay on a card opens the same Pay screen, with the bill, and Back returns to the plan', async ({ page }) => {
  await setUp(page);
  await page.goto('/net-worth/plan/pay-first');
  await page.getByRole('link', { name: 'Pay BCA Visa' }).click();
  await expect(page.getByRole('heading', { name: 'Pay credit card', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/transactions\/new\?/);
  const form = addForm(page);
  await expect(form.getByTestId('pay-card-to')).toContainText('BCA Visa');
  await expect(form).toContainText('3.000.000');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/plan\/pay-first$/);
});

test('the statement’s Pay for ticked purchases opens “Pay credit card” with them listed, and marks exactly those paid', async ({ page }) => {
  await setUp(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Pasar Satu', paidWith: 'BCA Visa', category: 'Groceries', amount: '450000' });
  await addTransaction(page, { description: 'Toko Dua', paidWith: 'BCA Visa', category: 'Groceries', amount: '80000' });
  await openCardPage(page);
  await cardPage(page, 'Statement');
  await page.getByLabel('Pay Pasar Satu').check();
  await page.getByLabel('Pay Toko Dua').check();

  const form = await openStatementPay(page);
  await expect(form.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /BCA Visa/ })).toHaveCount(0);
  await expect(form.getByTestId('pay-card-to')).toContainText('BCA Visa');
  await expect(form.getByRole('button', { name: 'From' })).not.toContainText('BCA Tahapan');
  // The total of the two, fixed: no keypad, no ✕. No fee, which the statement's payment cannot record.
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveText('530.000');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toBeDisabled();
  await expect(form.getByRole('button', { name: 'Clear amount' })).toHaveCount(0);
  await expect(form.getByText('Fees & charges')).toHaveCount(0);
  await expect(form.getByLabel('Note')).toHaveValue('Credit card payment');
  const listed = page.getByTestId('paying-purchases');
  await expect(listed).toContainText('Paying 2 purchases');
  await expect(listed).toContainText('Pasar Satu');
  await expect(listed).toContainText(/Rp\s450\.000/);
  await expect(listed).toContainText('Toko Dua');
  await expect(listed).toContainText(/Rp\s80\.000/);
  await expect(saveButton(form)).toBeDisabled();

  await chooseCardPayFrom(form, 'BCA Tahapan');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // Back on the statement: the ticks cleared into "paid", the bar gone, Hotel stay from last month untouched.
  await expect(page).toHaveURL(/\/cards\/[^/]+\/statement$/);
  await expect(page.getByTestId('statement-select-bar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pasar Satu, Paid \d+ \w+$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Toko Dua, Paid \d+ \w+$/ })).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '19.470.000');
});

test('no card payment offers a Goal row, even with goals; each still asks when it takes money promised to one', async ({ page }) => {
  // Jenius holds Rp 42.500.000 and promises Rp 37.500.000 of it: Rp 5.000.000 is free.
  await jeniusWithTwoGoals(page);
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await walletCard(page, 'BCA Visa').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Laptop', paidWith: 'BCA Visa', category: 'Groceries', amount: '6800000', date: LAST_MONTH, paidOff: false });
  await addTransaction(page, { description: 'Monitor', paidWith: 'BCA Visa', category: 'Groceries', amount: '5500000' });
  const asks = page.getByText(/more than is free/);
  const goalRow = (form: Locator) => form.getByRole('button', { name: /^Goal/ });

  // The statement's Pay for a ticked purchase: Rp 5.500.000 from Jenius is Rp 500.000 over.
  await openCardPage(page);
  await cardPage(page, 'Statement');
  await page.getByLabel('Pay Monitor').check();
  const chosen = await openStatementPay(page);
  await expect(goalRow(chosen)).toHaveCount(0);
  await chooseCardPayFrom(chosen, 'Jenius');
  await expect(page.getByText(/500\.000 more than is free/)).toBeVisible();
  await expect(saveButton(chosen)).toBeDisabled();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(chosen).toHaveCount(0);

  // The card's Pay: the Rp 6.800.000 bill, Rp 1.800.000 over.
  await openCardPage(page);
  const pay = await openCardPay(page);
  await expect(goalRow(pay)).toHaveCount(0);
  await chooseCardPayFrom(pay, 'Jenius');
  await expect(page.getByText(/1\.800\.000 more than is free/)).toBeVisible();
  await expect(saveButton(pay)).toBeDisabled();
  await page.getByRole('button', { name: 'Take from Emergency fund' }).click();
  await page.getByRole('button', { name: 'No — borrowing from it' }).click();
  await saveButton(pay).click();
  await expect(pay).toHaveCount(0);

  // Edit payment: still no Goal row, and the question it was saved with is asked again.
  await openAccountHistory(page, 'Jenius');
  await page.getByText('Credit card payment').first().click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Edit payment', exact: true })).toBeVisible();
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  await expect(goalRow(edit)).toHaveCount(0);
  await expect(asks).toBeVisible();
});
