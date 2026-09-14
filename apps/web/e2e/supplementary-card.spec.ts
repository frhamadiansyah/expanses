import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCardAccount(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('Mandiri Bonvoy');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByLabel('Bank', { exact: true }).selectOption('Mandiri');
  await page.getByLabel('Last 4 digits').fill('1467');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'Mandiri Bonvoy', exact: true })).toBeVisible();
}

async function openTheCard(page: Page) {
  await page.goto('/cards');
  await page.getByRole('link', { name: 'Mandiri Bonvoy', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mandiri Bonvoy' })).toBeVisible();
}

test('a second card joins the same statement, and a purchase records which one', async ({ page }) => {
  await addCardAccount(page);

  // One card, so the form has nothing to ask about.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Paid with').selectOption({ label: 'Mandiri Bonvoy (IDR)' });
  await expect(page.getByLabel('Card', { exact: true })).toHaveCount(0);

  // The supplementary card: same account, same statement, its own digits.
  await openTheCard(page);
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByLabel('Whose card').fill('Spouse');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  // Now it is worth asking, because one statement carries both.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Ranch Market');
  await page.getByLabel('Paid with').selectOption({ label: 'Mandiri Bonvoy (IDR)' });
  await expect(page.getByLabel('Card', { exact: true })).toBeVisible();
  await page.getByLabel('Card', { exact: true }).selectOption({ label: '···· 8802 · Spouse' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill('450000');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Ranch Market')).toBeVisible();
});

test('removing a card leaves the account and its statement alone', async ({ page }) => {
  await addCardAccount(page);
  await openTheCard(page);
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  await page.getByRole('button', { name: 'Remove card ending 8802' }).click();

  await expect(page.getByTestId('card-on-account')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Mandiri Bonvoy' })).toBeVisible();
});
