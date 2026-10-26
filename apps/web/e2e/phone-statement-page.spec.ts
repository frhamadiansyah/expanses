import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage } from './card-section';

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const TODAY = local(now);
const LAST_MONTH = local(new Date(now.getFullYear(), now.getMonth() - 1, 15));

async function buy(page: Page, description: string, amount: string, on: string) {
  await page.goto('/transactions');
  await addTransaction(page, { description, paidWith: 'BCA Visa', category: 'Groceries', amount, date: on });
}

async function openStatement(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await openCard(page, { name: 'BCA Visa' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await page.getByRole('button', { name: 'Save terms' }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await buy(page, 'Hotel Mulia', '2000000', LAST_MONTH);
  await buy(page, 'Superindo', '450000', TODAY);
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
}

test('the statement page: a bar with two icons, and one box holding the stepper and the figures', async ({ page }) => {
  await openStatement(page);

  await expect(page.getByRole('heading', { name: 'Statement', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'BCA Visa', exact: true })).toBeVisible();
  await expect(page.getByTestId('check-statement')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Search statements' })).toBeVisible();

  // The Statements header, the Check statement row and the search field are gone from the page.
  await expect(page.getByText('Statements', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await expect(page.getByText("Compare screenshots of the bank's statement")).toHaveCount(0);

  // The stepper is the first row of the band's box.
  const band = page.getByTestId('statement-band');
  await expect(band.getByTestId('statement-range')).toBeVisible();
  await expect(band.getByRole('button', { name: 'Earlier statement' })).toBeVisible();
  await expect(band.getByTestId('statement-total')).toBeVisible();
  await band.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(band.getByTestId('statement-range')).toBeVisible();
});

test('the search icon puts a field over the whole bar, finds across statements, and the cross puts the bar back', async ({ page }) => {
  await openStatement(page);
  const title = page.getByRole('heading', { name: 'Statement', exact: true });

  await page.getByRole('button', { name: 'Search statements' }).click();
  const field = page.getByRole('searchbox', { name: 'Search statements' });
  await expect(field).toBeVisible();
  await expect(field).toHaveAttribute('placeholder', 'Description, category, digits or amount');
  await expect(title).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'BCA Visa', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('check-statement')).toHaveCount(0);

  await field.fill('mulia');
  const results = page.getByTestId('statement-search-results');
  await expect(results.getByRole('button')).toHaveCount(1);
  await expect(results).toContainText('Hotel Mulia');

  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(field).toHaveCount(0);
  await expect(title).toBeVisible();
  await expect(page.getByTestId('check-statement')).toBeVisible();
  await expect(page.getByTestId('statement-search-results')).toHaveCount(0);
});

test('the check icon goes to the check page with the dates of the statement on screen', async ({ page }) => {
  await openStatement(page);
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-range')).toContainText('–');

  await page.getByTestId('check-statement').click();
  await expect(page.getByRole('heading', { name: 'Check statement' })).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toMatch(/^\/cards\/[^/]+\/check$/);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(end! > start!).toBe(true);
});

test('‹ never loops between the Statement and its check: Check goes to Statement, Statement to the card', async ({ page }) => {
  await openStatement(page);
  await page.getByTestId('check-statement').click();
  await expect(page.getByRole('heading', { name: 'Check statement' })).toBeVisible();

  await page.getByRole('link', { name: 'Statement' }).first().click();
  await expect(page).toHaveURL(/\/cards\/[^/]+\/statement/);
  await page.getByRole('link', { name: /BCA Visa/ }).first().click();
  await expect(page).toHaveURL(/\/cards\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'BCA Visa' })).toBeVisible();
});
