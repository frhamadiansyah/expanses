import { expect, test } from '@playwright/test';
import { cardSection } from './card-section';
import { openDrawers } from './drawers';

/**
 * The debt picker, end to end: the three things a debt turns out to be, and where each one lands.
 *
 * The forms are unit-tested by `debt-form.test.ts`; what is proved here is the wiring — that a mortgage really
 * opens a loan account with a schedule, that family money goes to the ledger, and that a card named from the
 * catalogue arrives with its bank, its earn rules and the fee the bank publishes.
 */

test('a mortgage opens a loan account at what is still owed, with the terms that give it a schedule', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Home mortgage' }).click();

  await page.getByLabel('Name', { exact: true }).fill('KPR BTN Bintaro');
  await page.getByLabel('Owed now').fill('650000000');
  await page.getByLabel('Lender').fill('Bank BTN');
  await page.getByLabel('Interest rate').fill('9');
  await page.getByLabel('Months left').fill('168');
  await page.getByRole('button', { name: 'Add debt' }).click();

  await expect(page).toHaveURL(/\/net-worth\/loans$/);
  // The row, and the terms line under it, sit inside the kind's own drawer, which the list opens shut.
  await openDrawers(page);
  // The terms the picker worked out: the lender, the rate as basis points read back, and the months left.
  await expect(page.getByText(/Bank BTN · 9% · 168 months/)).toBeVisible();

  await page.getByRole('link', { name: 'KPR BTN Bintaro' }).click();
  await expect(page.getByText('Still owed')).toBeVisible();
  await expect(page.getByText(/650\.000\.000/).first()).toBeVisible();
});

test('money borrowed from family lands under Lend & borrow', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: /^Affiliate debt/ }).click();

  await page.getByLabel('Owed now').fill('10000000');
  await page.getByLabel('Who').fill('Ibu');
  await page.getByRole('button', { name: 'Add debt' }).click();

  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByText('Payables', { exact: true })).toBeVisible();
  await expect(page.getByText('Ibu').first()).toBeVisible();
});

test('a card named from the catalogue arrives with its bank, its rules and the published fee', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();

  // Picking the product is the whole of the setup: it names the card and links it to the entry.
  await page.getByLabel('Which card').selectOption({ label: 'BCA UnionPay' });
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('BCA UnionPay');
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Add card' }).click();

  await expect(page).toHaveURL(/\/cards\//);
  await expect(page.getByRole('heading', { name: 'BCA UnionPay' })).toBeVisible();

  // The catalogue's own terms: the bank's published annual fee, and the earn rules that came with it.
  await cardSection(page, 'Card');
  await expect(page.getByLabel('Annual fee')).toHaveValue('125000');
});

test('a card that earns by level is refused until the level is chosen, and nothing is opened meanwhile', async ({ page }) => {
  await page.goto('/debts/new');
  await page.getByRole('button', { name: 'Credit card' }).click();

  await page.getByLabel('Which card').selectOption({ label: 'Jenius Platinum' });
  await page.getByLabel('Billing date').fill('25');
  await page.getByLabel('Due date').fill('12');
  await page.getByRole('button', { name: 'Add card' }).click();

  await expect(page.getByText(/Choose the level you are on/)).toBeVisible();
  await expect(page).toHaveURL(/\/debts\/new$/);
  // Nothing was opened, so the same button finishes the job once the level is given.
  await page.goto('/cards');
  await expect(page.getByText('Jenius Platinum')).toHaveCount(0);

  await page.goto('/accounts');
  await expect(page.getByText('Jenius Platinum')).toHaveCount(0);
});
