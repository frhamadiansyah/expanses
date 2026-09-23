import { expect, type Page, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addCardAccount(page: Page) {
  await openCard(page, { name: 'Mandiri Bonvoy', bank: 'Mandiri', last4: '1467' });
}

async function openTheCard(page: Page) {
  await page.goto('/cards');
  await page.getByRole('link', { name: /^Mandiri Bonvoy(,|$)/ }).click();
  await expect(page.getByRole('heading', { name: 'Mandiri Bonvoy' })).toBeVisible();
}

test('a second card joins the same statement, and a purchase records which one', async ({ page }) => {
  await addCardAccount(page);

  // One card, so Paid with is one row and there is nothing left to ask.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByRole('dialog', { name: 'Add a transaction' }).getByRole('button', { name: 'Paid with' }).click();
  await expect(page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'Mandiri Bonvoy', exact: true })).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /Mandiri Bonvoy ····/ })).toHaveCount(0);

  // The supplementary card: same account, same statement, its own digits.
  await openTheCard(page);
  await page.getByLabel('Last 4 digits').fill('8802');
  await page.getByLabel('Whose card').fill('Spouse');
  await page.getByRole('button', { name: 'Add card' }).click();
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);

  // Now each card is its own row, so choosing one answers both questions at once.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Ranch Market', paidWith: 'Mandiri Bonvoy ···· 8802', category: 'Groceries', amount: '450000' });

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
