import { expect, type Locator, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccountHistory } from './accounts';
import { addForm, chooseGoal, choosePayment, chooseTo, saveButton } from './add-transaction';
import { addGoal, addMoneyAccount, goalCard, typeAmount, typeSecondFigure } from './set-aside';

/*
 * The Transfer tab's fee row (option A): the Amount alone on its row, the fee on its own row under it — its category on
 * the left, the figure on the right — and For goal under Add more details. A transfer for a goal takes a fee too: the
 * fee is spending beside the move, and the goal gains the transfer alone. Invented accounts and figures.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function openReceipt(page: Page, what: string) {
  // From the paying account's history: Cashflow lists the transfer only while its fee counts (owner 2026-11-16).
  await openAccountHistory(page, 'Tabungan A');
  const row = page.getByTestId('transaction-row').filter({ hasText: what }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button').filter({ hasNotText: /^$/ }).first().click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
}

async function goalFigure(page: Page): Promise<Locator> {
  return goalCard(page, 'Kyoto trip');
}

test('a transfer for a goal takes a fee on its own row: the account pays both, the goal gains the transfer alone', async ({ page }) => {
  await addMoneyAccount(page, 'Tabungan A', 'bank', '20000000');
  await addMoneyAccount(page, 'Tabungan B', 'savings', '0');
  await addGoal(page, 'Kyoto trip', '30000000');

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(page, 'Tabungan A', 'From');
  await chooseTo(form, 'Tabungan B');

  // The Amount row is the amount alone: no fee beside it.
  await typeAmount(page, form, '1000000');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveText('1.000.000');

  // The fee row: the category on the left, defaulting to Fees & charges, and a grey "Fee" until one is typed.
  const feeRow = form.getByTestId('fee-row');
  await expect(feeRow.getByRole('button', { name: 'Fee category' })).toContainText('Fees & charges');
  await expect(feeRow.getByLabel(/^Fee in IDR$/)).toHaveText('Fee');
  await typeSecondFigure(page, form, /^Fee in IDR$/, '2500');
  await expect(feeRow.getByLabel(/^Fee in IDR$/)).toHaveText('2.500');
  await form.getByLabel('Note').fill('A to B for Kyoto');
  if (process.env.FEE_ROW_SHOT) await page.screenshot({ path: process.env.FEE_ROW_SHOT });

  // Goal is a box of its own under the form (None until one is chosen), and the fee row stays when a goal is chosen.
  await expect(form.getByRole('button', { name: /^Goal/ })).toContainText('None');
  await chooseGoal(form, 'Kyoto trip');
  await expect(form.getByRole('button', { name: /^Goal/ })).toContainText('Kyoto trip');
  await expect(page.getByRole('region', { name: 'More details' }).getByRole('button', { name: 'Fee category' })).toHaveCount(0);
  await expect(feeRow.getByLabel(/^Fee in IDR$/)).toHaveText('2.500');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await page.goto('/wallet');
  await expectWalletFigure(page, 'Tabungan A', '18.997.500');
  await expectWalletFigure(page, 'Tabungan B', '1.000.000');
  // The goal gained the transfer, never the fee.
  const goal = await goalFigure(page);
  await expect(goal).toContainText('1.000.000');
  await expect(goal).not.toContainText('1.002.500');

  // Edited, the fee is read back on its row and taken out to nothing; the transfer stays the goal's.
  await openReceipt(page, 'A to B for Kyoto');
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit transaction' }).or(page.getByRole('form', { name: 'Edit a transaction' }));
  await expect(edit).toBeVisible();
  const editFee = edit.getByTestId('fee-row').getByLabel(/^Fee in IDR$/);
  await expect(editFee).toHaveText('2.500');
  await editFee.click();
  const keypad = page.getByTestId('keypad');
  await keypad.getByRole('button', { name: 'C', exact: true }).click();
  // Nothing to settle: the dock is put away by its ✕.
  await keypad.getByRole('button', { name: 'Close keypad' }).click();
  await expect(keypad).toBeHidden();
  await expect(editFee).toHaveText('Fee');
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);

  await page.goto('/wallet');
  await expectWalletFigure(page, 'Tabungan A', '19.000.000');
  await expectWalletFigure(page, 'Tabungan B', '1.000.000');
  await expect(await goalFigure(page)).toContainText('1.000.000');

  // Deleted, everything goes: both accounts back where they started.
  await openReceipt(page, 'A to B for Kyoto');
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Tabungan A', '20.000.000');
  await expectWalletFigure(page, 'Tabungan B', '0');
});
