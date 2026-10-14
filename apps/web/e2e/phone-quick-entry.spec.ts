import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addForm, addTransaction, choosePayment, openAmount, saveButton } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

test('an expense saved with its category left for later waits under Uncategorised until one is chosen', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');

  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  for (const key of '25000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Tahapan');
  // No category chosen: the row offers to choose it later, and the ✓ saves anyway.
  await expect(form.getByRole('button', { name: /^Category/ })).toContainText('Choose later');
  await form.getByLabel('Note').fill('Mystery stall');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // The row wears the amber question and says what it is filed under.
  const mystery = row(page, 'Mystery stall');
  await expect(mystery).toContainText('Uncategorised');
  await expect(mystery.locator('[data-testid="category-mark"][data-unknown]')).toHaveCount(1);

  // The box above the history counts it, and tapping the line shows just those.
  const waiting = page.getByTestId('needs-category-card');
  await expect(waiting).toContainText('1 need a category');
  await waiting.click();
  await expect(page.getByTestId('active-filters')).toContainText('Needs a category');
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);

  // The row's circle fixes the category; Uncategorised is never one of the choices.
  await page.getByRole('button', { name: 'Category for Mystery stall' }).click();
  const picker = page.getByRole('dialog', { name: 'Category for Mystery stall' });
  await expect(picker.getByRole('button', { name: 'Uncategorised', exact: true })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(page.getByTestId('needs-category-card')).toHaveCount(0);
  await expect(row(page, 'Mystery stall')).toContainText('Restaurants');
});

test('a refund typed with a minus nets the category it went back under: the car rental', async ({ page }) => {
  await openAccount(page, { subtype: 'credit_card', name: 'Travel Card' });
  await page.goto('/transactions');
  // Rent 500.000 and a deposit of 500.000, both on the card.
  await addTransaction(page, { description: 'Car rental', paidWith: 'Travel Card', category: 'Ride hailing', amount: '1000000' });

  // Days later the deposit comes back, less 50.000 of toll.
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  for (const key of ['−', ...'500000', '+', ...'50000']) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveText('−450.000');
  await expect(form.getByRole('button', { name: 'Amount', exact: true })).toHaveCSS('color', 'rgb(36, 138, 61)');
  // Money back goes into the card it was paid with.
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(page, 'Travel Card', 'Into');
  await expect(page.getByTestId('refund-caption')).toHaveText('Refund: money back to Travel Card');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Ride hailing', exact: true }).click();
  await form.getByLabel('Note').fill('Deposit back');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  const refund = row(page, 'Deposit back');
  await expect(refund).toContainText('+Rp');
  await expect(refund).toContainText('450.000');
  await expect(refund).toContainText('Refund');

  // By category, Ride hailing spent 550.000, not 1.000.000, and nothing of it is income.
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  await expect(page.getByText('550.000').first()).toBeVisible();
});

test('typing a note fills an empty category with the one that note had last time, and ✓ saves under it', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Cafe & dessert', amount: '30000' });

  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  for (const key of '32000') await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: /^Paid with/ }).click();
  await choosePayment(page, 'BCA Tahapan');
  const category = form.getByRole('button', { name: /^Category/ });
  await expect(category).toContainText('Choose later');
  await form.getByLabel('Note').fill('Kopi Kenangan');
  // Filled from history, and drawn exactly as a category chosen by hand: no marker says where it came from.
  await expect(category).toContainText('Cafe & dessert');
  await expect(category).not.toContainText(/history/i);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(row(page, 'Kopi Kenangan')).toHaveCount(2);
  for (const each of await row(page, 'Kopi Kenangan').all()) await expect(each).toContainText('Cafe & dessert');
});
