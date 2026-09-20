import { expect, type Page, test } from '@playwright/test';
import { closeDetails, shareWith } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  await page.getByLabel(balanceLabel).fill(amount);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

async function lend(page: Page, person: string, amount: string, from: string) {
  await page.goto('/net-worth/debts');
  await page.getByRole('button', { name: 'Add a loan' }).click();
  await page.getByLabel('Person').fill(person);
  await page.getByLabel(/^Amount/).fill(amount);
  await page.getByLabel('Paid from').selectOption({ label: from });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: person })).toBeVisible();
}

test('lending on a credit card raises the card, earns points, and is never spending', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addAccount(page, 'BCA KrisFlyer', 'credit_card', 'Amount owed now', '0');

  await page.goto('/net-worth/debts');
  await page.getByRole('button', { name: 'Add a loan' }).click();
  await page.getByLabel('Person').fill('Andi');
  await page.getByLabel(/^Amount/).fill('4000000');
  await page.getByLabel('Paid from').selectOption({ label: 'BCA KrisFlyer (IDR)' });
  await page.getByLabel('Category for points').selectOption({ label: 'Shopping (general)' });
  await page.getByLabel('MCC').fill('5311');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByText(/4\.000\.000/).first()).toBeVisible();

  // The bank never moved, the card owes it, and net worth is unchanged: a loan is not spending.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('50.000.000');
  await expect(page.getByText('Owed to you').first()).toBeVisible();
  await expect(page.getByText('Due within a year').first()).toBeVisible();

  // Spending stays empty, because no expense category was touched.
  await page.goto('/spending');
  await expect(page.getByText(/4\.000\.000/)).toHaveCount(0);
});

test('records a repayment and the balance falls', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '10000000', 'BCA Tahapan (IDR)');

  await page.getByRole('button', { name: 'Record repayment' }).click();
  await page.getByLabel(/How much came back/).fill('4000000');
  await page.getByRole('button', { name: 'Save repayment' }).click();

  await expect(page.getByText(/6\.000\.000/).first()).toBeVisible();
});

test('refuses a repayment bigger than the debt, by name', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '9000000', 'BCA Tahapan (IDR)');

  await page.getByRole('button', { name: 'Record repayment' }).click();
  await page.getByLabel(/How much came back/).fill('12000000');
  await page.getByRole('button', { name: 'Save repayment' }).click();

  await expect(page.getByText(/Andi owes Rp\s?9\.000\.000/)).toBeVisible();
});

test('forgiving the rest closes the debt and takes it off the balance sheet', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await lend(page, 'Andi', '10000000', 'BCA Tahapan (IDR)');

  await page.getByRole('button', { name: 'Forgive rest' }).click();
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
  await page.goto('/net-worth/debts');
  await expect(page.getByRole('heading', { name: 'Andi' })).toBeVisible();
  await expect(page.getByText(/600\.000/).first()).toBeVisible();

  await page.goto('/spending');
  await expect(page.getByText(/300\.000/).first()).toBeVisible();
});
