import { expect, type Page, test } from '@playwright/test';

const TODAY = new Date().toISOString().slice(0, 10);

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('90000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
}

async function addEvent(page: Page, name: string, set: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'Add an event' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Categories').selectOption({ label: set });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByTestId('event-row')).toContainText(name);
}

test('an event records its spending in its own categories, from its own page', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Rumah Bintaro', 'Renovation');

  await page.getByRole('link', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Rumah Bintaro' })).toBeVisible();
  await expect(page.getByText('draws on Renovation')).toBeVisible();

  await page.getByLabel('Description').fill('Keramik lantai');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Flooring & Tiles' });
  await page.getByLabel('Amount', { exact: true }).fill('7500000');
  await page.getByRole('button', { name: 'Save' }).click();

  // Tagged to the event as it was written, so the total stands without any hunting afterwards.
  await expect(page.getByTestId('event-total')).toContainText('7.500.000');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('Flooring & Tiles');
});

test('a set stays out of the monthly categories, and its spending out of the monthly caps', async ({ page }) => {
  await addWallet(page);
  await addEvent(page, 'Bayi', 'Newborn');
  await page.getByRole('link', { name: 'Open' }).click();
  await page.getByLabel('Description').fill('Popok');
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: 'Diapering' });
  await page.getByLabel('Amount', { exact: true }).fill('900000');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('event-total')).toContainText('900.000');

  // The everyday form offers the monthly tree only: a newborn's categories are not what you file the shop under.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Diapering' })).toHaveCount(0);
  await expect(page.getByLabel('Category').locator('option', { hasText: 'Groceries' })).toHaveCount(1);

  // And the budget plans the month, not the event.
  await page.goto('/budget');
  await expect(page.getByLabel('Category', { exact: true }).locator('option', { hasText: 'Diapering' })).toHaveCount(0);
  await expect(page.getByTestId('line-Diapering')).toHaveCount(0);

  // Spending still has to be visible somewhere, grouped as the set it belongs to.
  await page.goto('/spending');
  await expect(page.getByTestId('set-group-Newborn')).toContainText('Diapering');
  await expect(page.getByTestId('set-group-Newborn')).toContainText('900.000');
});
