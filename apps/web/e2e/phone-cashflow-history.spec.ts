import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, startSelecting, historyMenu } from './add-transaction';
import { TODAY } from './event-plan';

const row = (page: Page, what: string) => page.getByTestId('transaction-row').filter({ hasText: what });

async function eventWith(page: Page, name: string) {
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Starts on').fill(TODAY);
  await page.getByLabel('Ends on').fill(TODAY);
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('event spending is not listed in Cashflow, by day or by category, nor found by its search', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await eventWith(page, 'Lombok trip');
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Rembiga', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '85000' });
  await addTransaction(page, { description: 'Kopi Tuku', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '24000' });
  await startSelecting(page);
  await page.getByRole('checkbox', { name: 'Select Sate Rembiga' }).click();
  await page.getByRole('toolbar', { name: 'Selected transactions' }).getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Add to event' }).click();
  await page.getByRole('dialog', { name: 'Add to event' }).getByRole('button', { name: 'Lombok trip' }).click();

  await expect(row(page, 'Sate Rembiga')).toHaveCount(0);
  await expect(row(page, 'Kopi Tuku')).toHaveCount(1);

  // By category: the group counts one transaction, not two.
  await page.getByRole('button', { name: 'Categories', exact: true }).click();
  const group = page.getByTestId('category-group').filter({ hasText: 'Restaurants' });
  await expect(group).toContainText('1 transaction');
  await expect(page.getByText('Sate Rembiga')).toHaveCount(0);
  await page.getByRole('button', { name: 'Days', exact: true }).click();

  // Search reads the same list, so the event purchase is not found there either.
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByLabel('Search transactions').fill('Sate');
  await expect(row(page, 'Sate Rembiga')).toHaveCount(0);
});

test('the history header is a bold Transactions title, and Paid with offers only accounts with transactions', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await openAccount(page, { subtype: 'cash', name: 'Brankas', balance: '0' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Kenangan', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '38000' });
  const header = page.getByRole('heading', { name: 'Transactions', exact: true });
  await expect(header).toHaveCSS('font-size', '20px');
  await expect(header).toHaveCSS('font-weight', '700');
  await expect(header).toHaveCSS('text-transform', 'none');

  await historyMenu(page).click();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Paid with' });
  await expect(sheet.getByRole('button', { name: /^BCA Tahapan/ })).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Brankas/ })).toHaveCount(0);
});

test('a trip running today has a row at the top of Cashflow that opens it; a far-future one has none', async ({ page }) => {
  await eventWith(page, 'Lombok trip');
  await page.goto('/events');
  await page.getByRole('button', { name: 'New event' }).click();
  await page.getByTestId('new-event').click();
  await page.getByLabel('Name', { exact: true }).fill('Next year');
  await page.getByLabel('Starts on').fill('2099-01-01');
  await page.getByLabel('Ends on').fill('2099-01-05');
  await page.getByRole('button', { name: 'Save event' }).click();
  await expect(page.getByRole('heading', { name: 'Next year', exact: true })).toBeVisible();

  await page.goto('/transactions');
  const trips = page.getByTestId('travel-row');
  await expect(trips).toHaveCount(1);
  await expect(trips).toContainText('Lombok trip');
  await expect(trips).toContainText('Today · day 1 of 1');
  await trips.click();
  await expect(page.getByRole('heading', { name: 'Lombok trip', exact: true })).toBeVisible();
});
