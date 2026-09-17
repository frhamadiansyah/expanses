import { expect, type Page, test } from '@playwright/test';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function spend(page: Page, what: string, category: string, amount: string) {
  await page.getByRole('navigation', { name: 'Main' }).getByRole('button', { name: 'Add a transaction' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a transaction' });
  await sheet.getByLabel('Description').fill(what);
  await sheet.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await sheet.getByLabel('Amount', { exact: true }).fill(amount);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toHaveCount(0);
}

test('the budget page puts the budget first and says what is left or over under it', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await spend(page, 'Warung Steak', 'Restaurants', '500000');
  await spend(page, 'Grab', 'Ride hailing', '120000');

  await page.goto('/budget');
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Food and beverage' });
  await page.getByLabel('Monthly amount (IDR)').fill('300000');
  await page.getByRole('button', { name: 'Set budget' }).click();
  // Saved before leaving: the budget screen already shows the month past it.
  await expect(page.getByTestId('line-Food and beverage')).toContainText('Over by');

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Against budget' }).click();
  await page.getByTestId('see-categories').click();

  const food = page.getByTestId('report-row').filter({ hasText: 'Food and beverage' });
  // The budget leads the row; under it, what went out with its share, and how far past the budget it went.
  await expect(food).toContainText('300.000');
  await expect(food).toContainText('500.000 · 167%');
  await expect(food).toContainText('200.000 over');

  // A category with no budget keeps the shape: its spend, and no share of a budget that does not exist.
  const transport = page.getByTestId('report-row').filter({ hasText: 'Transportation' });
  await expect(transport).toContainText('no budget');
  await expect(transport).not.toContainText('%');
});
