import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccount, openAccountHistory, openCard, walletCard } from './accounts';
import { addForm, addTransaction, saveButton } from './add-transaction';
import { cardPage, chooseCardPayFrom, openCardPay, saveCardTerms, showCardBack } from './card-section';
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
  await addTransaction(page, { description: 'Hotel stay', paidWith: 'BCA Visa', category: 'Groceries', amount: '3000000', date: LAST_MONTH });
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

  // Edited later, the payment opens on the ordinary Edit screen with the card still its To, and saves.
  await openAccountHistory(page, 'BCA Tahapan');
  await page.getByText('Credit card payment').first().click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(page.getByRole('heading', { name: 'Edit transaction', exact: true })).toBeVisible();
  const edit = addForm(page).or(page.getByRole('form', { name: 'Edit a transaction' }));
  await expect(edit.getByRole('button', { name: /^To/ })).toContainText('BCA Visa');
  await edit.getByLabel('Note').fill('Visa bill paid');
  await saveButton(edit).click();
  await expect(page.getByRole('heading', { name: 'Edit transaction', exact: true })).toHaveCount(0);
  await openAccountHistory(page, 'BCA Tahapan');
  await expect(page.getByText('Visa bill paid').first()).toBeVisible();
  await page.goto('/wallet');
  await expectWalletFigure(page, 'BCA Tahapan', '17.000.000');
  await openCardPage(page);
  await showCardBack(page);
  await expect(page.getByTestId('tile-left-to-pay')).toContainText('Paid in full');
});

test('Spend opens “New expense” on the card: no tabs, Paid with the card', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa' });
  await openCardPage(page);
  await page.getByRole('group', { name: 'Actions' }).getByRole('link', { name: 'Spend', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New expense', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /BCA Visa/ })).toHaveCount(0);
  const form = addForm(page);
  await expect(form.getByRole('radio')).toHaveCount(0);
  await expect(form.getByRole('button', { name: /^Paid with/ })).toContainText('BCA Visa');
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
