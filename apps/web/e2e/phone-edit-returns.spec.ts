import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { recordIntoEvent, TODAY } from './event-plan';
import { addTransaction, saveButton } from './add-transaction';

/** An edit goes back to the page it was opened from — an event stays an event, Cashflow stays Cashflow. */

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });
const editForm = (page: Page) => page.getByRole('form', { name: 'Edit a transaction' });

async function tripWithSpend(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill('Singapore');
  await page.getByLabel('Categories').selectOption({ label: 'Holiday' });
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Singapore', exact: true })).toBeVisible();
  await recordIntoEvent(page, { description: 'Hotel', category: 'Lodging', amount: '3900000' });
  await expect(page.getByTestId('event-history').filter({ hasText: 'Hotel' })).toBeVisible();
}

test('a category fixed from an event row, by its circle or by Edit, leaves the page on the event', async ({ page }) => {
  await tripWithSpend(page);
  const event = new URL(page.url()).pathname;
  const hotel = () => page.getByTestId('event-history').filter({ hasText: 'Hotel' });

  await page.getByRole('button', { name: 'Category for Hotel' }).click();
  await page.getByRole('dialog', { name: 'Category for Hotel' }).getByRole('button', { name: 'Flights', exact: true }).click();
  await expect(page.getByText('Moved to Flights')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(event);

  await hotel().getByRole('button', { name: /^Flights/ }).click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  await expect(page).toHaveURL(/\/edit$/);
  const form = editForm(page);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Lodging', exact: true }).click();
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Singapore', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(event);
});

test('a receipt opened from an event returns there after Delete', async ({ page }) => {
  await tripWithSpend(page);
  const event = new URL(page.url()).pathname;
  await page.getByTestId('event-history').filter({ hasText: 'Hotel' }).getByRole('button', { name: /^Lodging/ }).click();
  await page.getByRole('button', { name: 'Delete this transaction', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Singapore', exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(event);
});

test('an edit opened from Cashflow still returns to Cashflow', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '90000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '50000' });
  await row(page, 'Warung').getByRole('button', { name: /^Restaurants/ }).click();
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const form = editForm(page);
  await form.getByLabel('Note').fill('Warung Tebet');
  await saveButton(form).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(row(page, 'Warung Tebet')).toHaveCount(1);
});
