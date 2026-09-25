import { expect, test } from '@playwright/test';
import { digits, moneyIn, oneOfEach } from './debts-page';
import { openDrawers } from './drawers';

/** Liabilities at 390 px: one box of drawers, a trailing figure each, and the due split under it. */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('by thumb: Liabilities shows every kind with the right figures, each debt in its own currency', async ({ page }) => {
  await oneOfEach(page);
  await page.goto('/net-worth/loans');

  await expect(page.getByTestId('debts-total')).toContainText('Rp 731.950.000');
  // One box, a drawer per kind of debt — the mortgage and the multi-purpose loan apart, as the picker asked them.
  await expect(page.getByTestId('type-drawer-loan:home_mortgage')).toContainText('Home mortgage');
  await expect(page.getByTestId('type-drawer-loan:multi_purpose_loan')).toContainText('Multi-purpose loan');
  await expect(page.getByTestId('type-drawer-card:credit_card')).toContainText('Credit card');
  await expect(page.getByTestId('type-drawer-person:payable')).toContainText('Payables');
  await expect(page.getByTestId('debts-kind-total-home_mortgage')).toHaveText('Rp 712.500.000');
  await expect(page.getByTestId('debts-kind-total-multi_purpose_loan')).toHaveText('Rp 16.250.000');
  await expect(page.getByTestId('debts-kind-total-credit_card')).toHaveText('Rp 2.450.000');
  await expect(page.getByTestId('debts-kind-total-payable')).toHaveText('Rp 750.000');
  await openDrawers(page);

  // The dollar loan in dollars, with its rupiah beneath; a rupiah debt bare, as its drawer's figure names the currency.
  const dollar = page.getByRole('link', { name: /Dollar car loan/ });
  await expect(dollar).toContainText('US$1.000,00');
  await expect(dollar).toContainText('≈ Rp 16.250.000');
  const card = page.getByRole('link', { name: /BCA Visa/ });
  await expect(card).toContainText('2.450.000');
  // One line per debt on the phone too: no bill and no unbilled part on the row.
  await expect(card.getByText(/unbilled|due \d/)).toHaveCount(0);

  // The due split sits under the list, on this screen: the balance sheet reads what is owed by kind, and the two
  // screens share the whole rather than the split.
  const due = page.getByTestId('debts-due');
  await expect(due).toContainText('Due within a year');
  await expect(due).toContainText('the rest is long term');
  const within = digits(await due.innerText());
  expect(within).toBeGreaterThan(0);
  const owed = digits(moneyIn(await page.getByTestId('debts-total').innerText()));
  await page.goto('/net-worth');
  // The pair carries the side's own total, and it is waited for: the sheet paints before its ledger read answers.
  await expect(page.getByTestId('sheet-total-liabilities')).toContainText('Rp 731.950.000');
  const owedOnSheet = digits(await page.getByTestId('sheet-total-liabilities').innerText());
  expect(owedOnSheet).toBe(owed);

  // Nothing scrolls sideways at 390 px.
  await page.goto('/net-worth/loans');
  await expect(page.getByTestId('debts-total')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('by thumb: ＋ opens the chooser, and each row opens its own place', async ({ page }) => {
  await oneOfEach(page);
  await page.goto('/net-worth/loans');
  await page.getByRole('link', { name: 'Add a debt' }).tap();
  await expect(page).toHaveURL(/\/debts\/new$/);
  await expect(page.getByRole('button', { name: /^Credit card/ })).toBeVisible();

  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: /KPR BCA/ }).tap();
  await expect(page).toHaveURL(/\/net-worth\/loans\/[^/]+$/);
  await expect(page.getByText('Still owed')).toBeVisible();

  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: /BCA Visa/ }).tap();
  await expect(page).toHaveURL(/\/cards\/[^/?]+/);

  await page.goto('/net-worth/loans');
  await openDrawers(page);
  await page.getByRole('link', { name: /Dewi/ }).tap();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow\?person=Dewi$/);
  await expect(page.getByRole('heading', { name: 'Only Dewi' })).toBeVisible();
});

test('by thumb: the sections are behind the corner, and Lend & borrow is not one of them', async ({ page }) => {
  await page.goto('/net-worth');
  // No strip to hold them any more: the three sections are the corner's `…`, and each row is a link.
  await page.getByRole('button', { name: 'More' }).tap();
  const items = page.getByRole('menuitem');
  await expect(items).toHaveCount(3);
  await expect(items).toHaveText(['Assets', 'Buy & sell', 'Liabilities']);
  await expect(page.getByRole('menuitem', { name: 'Loans' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Liabilities' }).tap();
  await expect(page.getByRole('heading', { name: 'Liabilities', level: 1 })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).tap();
  await page.getByTestId('lend-borrow-row').tap();
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
  await expect(page.getByRole('heading', { name: 'Lend & borrow', level: 1 })).toBeVisible();

  // The address it used to be drawn at still answers.
  await page.goto('/net-worth/debts');
  await expect(page).toHaveURL(/\/net-worth\/lend-borrow$/);
});
