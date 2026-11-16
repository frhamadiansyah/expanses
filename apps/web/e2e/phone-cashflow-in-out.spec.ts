import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, openWalletAccount } from './accounts';
import { addForm, addTransaction, addTransfer, choosePayment, chooseTo, saveButton, showTransfers, startSelecting } from './add-transaction';
import { typeAmount, typeSecondFigure } from './set-aside';
import { cardPage } from './card-section';
import { TODAY } from './event-plan';

/*
 * Own transfers off Cashflow (owner, 2026-11-13, option C). A card paid from the bank and a wallet topped up are listed
 * in no workspace's Cashflow; the Transfers filter brings them back; the card's statement and the bank's own page keep
 * them; a transfer with a typed fee keeps its row, the fee being spending. Every name and figure is invented.
 */

const row = (page: Page, text: string) => page.getByTestId('transaction-row').filter({ hasText: text });

/** Pays a purchase off from the card's statement, as a person does: tick it, Pay, Pay Rp … from the bank. */
async function payFromStatement(page: Page, what: string) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Contoh Visa' }).first().click();
  await cardPage(page, 'Statement');
  await page.getByLabel(`Pay ${what}`).check();
  await page.getByTestId('statement-select-bar').getByRole('button', { name: 'Pay', exact: true }).click();
  await page.getByRole('dialog', { name: /^Pay / }).getByRole('button', { name: /^Pay Rp/ }).click();
  await expect(page.getByTestId('statement-select-bar')).toHaveCount(0);
}

/** A top-up with a typed fee, on the phone's keypad: the fee is spending beside the move. */
async function topUpWithFee(page: Page) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(page, 'Contoh Payroll', 'From');
  await chooseTo(form, 'Dompet');
  await typeAmount(page, form, '50000');
  await typeSecondFigure(page, form, /^Fee in IDR$/, '2500');
  await form.getByLabel('Note').fill('Top-up with fee');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

test('a card payment and a top-up leave Cashflow, Transfers brings them back, and the statement and the bank page keep them', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Contoh Payroll', balance: '20000000' });
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet', balance: '0' });
  await openCard(page, { name: 'Contoh Visa', statementDay: '31', dueDay: '15' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Toko Contoh', paidWith: 'Contoh Visa', category: 'Groceries', amount: '320000' });
  await payFromStatement(page, 'Toko Contoh');
  await page.goto('/transactions');
  await addTransfer(page, { from: 'Contoh Payroll', to: 'Dompet', amount: '100000', note: 'Plain top-up' });
  await topUpWithFee(page);

  await page.goto('/transactions');
  await expect(row(page, 'Toko Contoh')).toBeVisible();
  // The fee is spending: the transfer it was typed on keeps its row.
  await expect(row(page, 'Top-up with fee')).toBeVisible();
  await expect(row(page, 'Contoh Visa payment')).toHaveCount(0);
  await expect(row(page, 'Plain top-up')).toHaveCount(0);

  await showTransfers(page);
  await expect(row(page, 'Contoh Visa payment')).toBeVisible();
  await expect(row(page, 'Plain top-up')).toBeVisible();
  await expect(page.getByTestId('filter-on')).toBeVisible();

  // The card's statement and the bank's own page list them whatever Cashflow does.
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'Contoh Visa' }).first().click();
  await cardPage(page, 'Statement');
  await expect(page.getByRole('main')).toContainText('Contoh Visa payment');
  await openWalletAccount(page, 'Contoh Payroll');
  await expect(page.getByTestId('account-recent')).toContainText('Contoh Visa payment');
  await expect(page.getByTestId('account-recent')).toContainText('Plain top-up');
});

test('with nothing but own transfers in the month, the empty list offers them', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Contoh Payroll', balance: '20000000' });
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet', balance: '0' });
  await page.goto('/transactions');
  await addTransfer(page, { from: 'Contoh Payroll', to: 'Dompet', amount: '100000', note: 'Plain top-up' });
  await page.goto('/transactions');
  await expect(page.getByText('Only transfers in this period.')).toBeVisible();
  await page.getByRole('button', { name: 'Show transfers', exact: true }).click();
  await expect(row(page, 'Plain top-up')).toBeVisible();
});

test('a transfer Transfers shows is ticked and put on a trip like any row; Select All leaves the hidden ones alone', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Contoh Payroll', balance: '20000000' });
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet', balance: '0' });
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill('Contoh trip');
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Contoh trip', exact: true })).toBeVisible();
  const eventUrl = page.url();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Contoh', paidWith: 'Contoh Payroll', category: 'Restaurants', amount: '85000' });
  await addTransfer(page, { from: 'Contoh Payroll', to: 'Dompet', amount: '100000', note: 'Trip top-up' });
  await page.goto('/transactions');
  const bar = page.getByRole('toolbar', { name: 'Selected transactions' });
  const act = async (action: string) => {
    await bar.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: action }).click();
  };

  // Hidden, the top-up is not ticked by Select All.
  await startSelecting(page);
  await act('Select All');
  await expect(bar).toContainText('1 selected');
  await bar.getByRole('button', { name: 'Done', exact: true }).click();

  await showTransfers(page);
  await startSelecting(page);
  await page.getByRole('checkbox', { name: 'Select Trip top-up' }).click();
  await act('Add to event');
  await page.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Contoh trip' }).click();
  await expect(page.getByRole('status').filter({ hasText: /added to Contoh trip/ })).toBeVisible();
  // On the trip now: Cashflow leaves event rows to the Events page, Transfers on or not.
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Trip top-up' })).toHaveCount(0);
  await page.goto(eventUrl);
  await expect(page.getByTestId('event-history').filter({ hasText: 'Trip top-up' })).toHaveCount(1);
});

test('sideways, the table has its own Transfers switch, the same filter as upright', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Contoh Payroll', balance: '20000000' });
  await openAccount(page, { subtype: 'ewallet', name: 'Dompet', balance: '0' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Contoh', paidWith: 'Contoh Payroll', category: 'Restaurants', amount: '85000' });
  await addTransfer(page, { from: 'Contoh Payroll', to: 'Dompet', amount: '100000', note: 'Sideways top-up' });
  await page.setViewportSize({ width: 844, height: 390 });
  const table = page.getByTestId('sideways-table');
  // A table row's cells are inputs; each row names itself by its receipt link.
  const receipt = (what: string) => table.getByRole('link', { name: `Receipt for ${what}` });
  await expect(receipt('Warung Contoh')).toBeVisible();
  await expect(receipt('Sideways top-up')).toHaveCount(0);
  const toggle = page.getByTestId('sideways-bar').getByRole('button', { name: 'Transfers' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(receipt('Sideways top-up')).toBeVisible();
  // Upright again, the list keeps the filter: one state, two controls.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(row(page, 'Sideways top-up')).toBeVisible();
});
