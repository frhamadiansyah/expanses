import { expect, type Page, test } from '@playwright/test';

async function setUp(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.getByLabel('Description').fill('Superindo');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByLabel('Amount', { exact: true }).fill('500000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Superindo')).toBeVisible();
}

test('a purchase is corrected where it sits in the list, and the original is kept', async ({ page }) => {
  await setUp(page);

  await page.locator('li', { hasText: 'Superindo' }).click();
  await page.getByLabel('Row amount (IDR)').fill('750.000');
  const category = page.getByLabel('Row category');
  // Typed, not scrolled for: the first match is taken, and a parent comes before what is under it.
  await category.fill('shopp');
  await category.press('Enter');
  await expect(category).toHaveValue('Shopping');
  await page.getByLabel('Row description').press('Enter');

  const row = page.locator('li', { hasText: 'Superindo' });
  await expect(row).toContainText('750.000');
  await expect(row).toContainText('Shopping');

  await page.getByLabel('Show deleted').check();
  await expect(page.locator('li', { hasText: 'Superindo' })).toHaveCount(2);

  await page.goto('/spending');
  await expect(page.getByTestId('period-total')).toContainText('750.000');
});

test('deleting from the row asks twice, in place', async ({ page }) => {
  await setUp(page);

  await page.locator('li', { hasText: 'Superindo' }).click();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  // Armed, not gone: one press never deletes.
  await expect(page.getByLabel('Row description')).toHaveValue('Superindo');
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByText('Superindo')).toHaveCount(0);
});

test('search finds a purchase by its amount, and a filter can be cleared', async ({ page }) => {
  await setUp(page);

  await page.getByLabel('Search transactions').fill('500.000');
  await expect(page.getByText('Superindo')).toBeVisible();
  await page.getByLabel('Search transactions').fill('nothing like it');
  await expect(page.getByText(/Nothing matches/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page.getByText('Superindo')).toBeVisible();
});

/**
 * The desktop row tints on hover, and the row's content must not paint over that tint.
 *
 * The content layer carries `bg-white` on a phone, where it has to cover the Edit and Delete buttons behind it;
 * on a desktop the same class left the `hover:bg-slate-50` on the `<li>` showing in the `px-2` gutters alone.
 * Asserted as a computed colour rather than as a screenshot, so it can fail on the reason rather than on a pixel.
 */
test('a desktop row lets its hover tint through', async ({ page }) => {
  await setUp(page);
  const face = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).locator('> div').first();
  await expect(face).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
});
