import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { planFor, TODAY } from './event-plan';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function record(page: Page, description: string, category: string, amount: string) {
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Paid with').selectOption({ label: 'BCA Tahapan (IDR)' });
  await page.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByLabel('Description')).toHaveValue('');
}

test('an event reads like Cashflow: where it went, and a swipe to what it planned', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });

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
  // Where it went keeps every category: its share of the trip, and — since both were planned — what each was planned at.
  const rows = page.getByTestId('event-detail-sheet');
  await expect(rows).toContainText('52%');
  await expect(rows).toContainText(/3\.900\.000\s*of\s*Rp\s?3\.000\.000/);

  // Turned to the plan, the whole of what was spent in the planned categories against the whole of what was planned.
  await sheet.getByRole('button', { name: 'Against the plan' }).click();
  await expect(sheet).toContainText('Over the plan by');
  await expect(sheet).toContainText(/Rp\s?680\.000/);
  await expect(sheet).toContainText('Still to buy');

  // The event's own history sits under it.
  await expect(page.getByRole('heading', { name: 'Transaction history' })).toBeVisible();
  await expect(page.getByText('Garuda')).toBeVisible();

  // And the list shows it as a card with what it cost against its plan.
  await page.getByRole('link', { name: 'All events' }).click();
  await expect(page.getByTestId('event-row')).toContainText('8.180.000');
  await expect(page.getByTestId('event-row')).toContainText('7.500.000');
});
