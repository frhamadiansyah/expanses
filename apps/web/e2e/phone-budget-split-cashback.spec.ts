import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, addTransaction, choosePayment, openAmount, saveButton } from './add-transaction';

/*
 * Budget › ⋯ › Essential and lifestyle in a month with card cashback (owner, 17 Nov 2026): the three rows are shares of
 * what was bought, the cashback sits on its own line above Spent, and Spent is still what was bought less it. Invented
 * figures: groceries Rp 320.000 and a restaurant Rp 200.000 on BCA Visa, then Rp 75.000 promo cashback onto the card.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function typeAmount(page: Page, keys: string | readonly string[]) {
  const keypad = page.getByTestId('keypad');
  for (const key of keys) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
}

async function addCardCashback(page: Page, card: string, amount: string) {
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await typeAmount(page, ['−', ...amount]);
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(page, card, 'Into');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByTestId('category-card-cashback').click();
  await form.getByLabel('Note').fill('Promo cashback');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
}

async function openSplit(page: Page) {
  await page.goto('/budget');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Essential and lifestyle' }).click();
  return page.getByRole('dialog', { name: 'Essential and lifestyle' });
}

test('with card cashback: shares of what was bought, the cashback on its own line, Spent after it', async ({ page }) => {
  await openAccount(page, { subtype: 'credit_card', name: 'BCA Visa' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Supermarket', paidWith: 'BCA Visa', category: 'Groceries', amount: '320000' });
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Visa', category: 'Restaurants', amount: '200000' });
  await addCardCashback(page, 'BCA Visa', '75000');

  const sheet = await openSplit(page);
  await expect(sheet.getByTestId('essential-spent')).toHaveText(/^62% · Rp\s?320\.000$/);
  await expect(sheet.getByTestId('lifestyle-spent')).toHaveText(/^38% · Rp\s?200\.000$/);
  // Never below nought from the cashback, and never past 100% between them.
  await expect(sheet.getByTestId('debts-savings-spent')).toHaveText(/^0% · Rp\s?0$/);
  await expect(sheet.getByText('Cashback & Rewards')).toBeVisible();
  await expect(sheet.getByTestId('cashback-total')).toHaveText(/^[−-]Rp\s?75\.000$/);
  await expect(sheet.getByTestId('spent-total')).toHaveText(/^Rp\s?445\.000$/);

  // The bar follows the shares: blue 62%, orange 38%, no green.
  const widths = await sheet
    .getByTestId('split-bar')
    .locator('span')
    .evaluateAll((parts) => parts.map((part) => Math.round(Number.parseFloat((part as HTMLElement).style.width))));
  expect(widths).toEqual([62, 38, 0]);

  if (process.env.SPLIT_SHOT) await page.screenshot({ path: process.env.SPLIT_SHOT });
});

test('with no cashback the box is the single Spent row it always was', async ({ page }) => {
  await openAccount(page, { subtype: 'credit_card', name: 'BCA Visa' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Supermarket', paidWith: 'BCA Visa', category: 'Groceries', amount: '320000' });
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Visa', category: 'Restaurants', amount: '200000' });

  const sheet = await openSplit(page);
  await expect(sheet.getByTestId('essential-spent')).toHaveText(/^62% · Rp\s?320\.000$/);
  await expect(sheet.getByTestId('lifestyle-spent')).toHaveText(/^38% · Rp\s?200\.000$/);
  await expect(sheet.getByTestId('debts-savings-spent')).toHaveText(/^0% · Rp\s?0$/);
  await expect(sheet.getByTestId('cashback-total')).toHaveCount(0);
  await expect(sheet.getByText('Cashback & Rewards')).toHaveCount(0);
  await expect(sheet.getByTestId('spent-total')).toHaveText(/^Rp\s?520\.000$/);
});
