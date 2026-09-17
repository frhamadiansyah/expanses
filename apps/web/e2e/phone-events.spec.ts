import { expect, type Page, test } from '@playwright/test';

const NOW = new Date();
const TODAY = `${NOW.getFullYear()}-${String(NOW.getMonth() + 1).padStart(2, '0')}-${String(NOW.getDate()).padStart(2, '0')}`;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function record(page: Page, description: string, category: string, amount: string) {
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category').selectOption({ label: category });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('');
}

async function planFor(page: Page, category: string, amount: string) {
  await page.getByLabel('Category').selectOption({ label: category });
  await page.getByLabel('Planned', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Add category' }).click();
  await expect(page.getByRole('button', { name: `Stop drawing on ${category}` })).toBeVisible();
}

test('an event reads like Cashflow: where it went, and a swipe to what it planned', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('90000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();

  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Singapore');
  await page.getByLabel('Categories').selectOption({ label: 'Holiday' });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Singapore', exact: true })).toBeVisible();

  await planFor(page, 'Flights', '4500000');
  await planFor(page, 'Lodging', '3000000');

  await page.getByRole('button', { name: 'Add spending' }).click();
  await record(page, 'Garuda', 'Flights', '4280000');
  await record(page, 'Hotel', 'Lodging', '3900000');
  await page.getByRole('button', { name: 'Add spending' }).click();

  // No Expense and Income, and no arrows: an event is spending, and the list is one tap back.
  const sheet = page.getByTestId('event-sheet');
  await expect(sheet.getByRole('button', { name: /Show expenses|Show income/ })).toHaveCount(0);
  await expect(page.getByTestId('event-total')).toContainText('8.180.000');
  await expect(page.getByTestId('event-detail-sheet')).toContainText('52%');

  // Turned to the plan, the rows read each category against what was planned for it.
  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  const lodging = page.getByTestId('event-detail-sheet');
  await expect(lodging).toContainText(/Rp\s?900\.000 over/);
  await expect(sheet).toContainText('Over the plan by');

  // The event's own history sits under it.
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  await expect(page.getByText('Garuda')).toBeVisible();

  // And the list shows it as a card with what it cost against its plan.
  await page.getByRole('button', { name: 'All events' }).click();
  await expect(page.getByTestId('event-row')).toContainText('8.180.000');
  await expect(page.getByTestId('event-row')).toContainText('7.500.000');
});
