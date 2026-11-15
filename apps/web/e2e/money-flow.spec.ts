import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { recordMonth } from './money-flow';

/*
 * The Money flow box under the Cashflow chart: where the month's money came from, what it passed through and where
 * it went. Salary lands in the bank; groceries leave the bank and a ride leaves the card; a top-up moves money
 * between two accounts and is no flow at all; what was not spent is Saved. A tap on a category opens the list
 * filtered to it, and the › opens the same drawing on a screen of its own.
 */

// The box is set aside for now (2026-10-24): not mounted on Cashflow, and nothing leads to /transactions/flow.
test.skip(true, 'The Money flow box is set aside: not mounted on Cashflow, nothing leads to its screen.');

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the box draws the month’s flows, a category opens its list, and › opens the flow on its own screen', async ({ page }) => {
  await recordMonth(page);

  const box = page.getByTestId('money-flow');
  await expect(box).toBeVisible();
  // Left: the one source. Middle: the bank and the card — never the wallet, which only saw a transfer.
  await expect(box.locator('[data-testid^="flow-source-"]')).toHaveCount(1);
  await expect(box.locator('[data-testid^="flow-source-"]')).toContainText('Salary, wage, or pay');
  await expect(box.locator('[data-testid^="flow-account-"]')).toHaveCount(2);
  await expect(box.locator('[data-testid^="flow-account-"][aria-label^="BCA Tahapan"]')).toBeVisible();
  await expect(box.locator('[data-testid^="flow-account-"][aria-label^="BCA Visa"]')).toBeVisible();
  await expect(box.locator('[aria-label^="GoPay"]')).toHaveCount(0);
  // Right: the two categories — each folded into its top-level parent, as the ring folds them — then what was kept:
  // 12.000.000 in less 1.050.000 out.
  const targets = box.locator('[data-testid^="flow-target-"]');
  await expect(targets).toHaveCount(3);
  await expect(targets.nth(0)).toContainText('Household');
  await expect(targets.nth(1)).toContainText('Travel');
  await expect(box.getByTestId('flow-target-saved')).toHaveAttribute('aria-label', /^Saved: .*10\.950\.000/);
  const figures = box.getByTestId('money-flow-figures');
  await expect(figures).toContainText(/12\.000\.000\s*In/);
  await expect(figures).toContainText(/1\.050\.000\s*Out/);
  await expect(figures).toContainText(/10\.950\.000\s*Saved/);

  // A band into Household carries what left the bank for it, and a tap on the bar opens the list filtered to Household.
  await expect(box.locator('[data-testid^="flow-band-"][aria-label^="BCA Tahapan to Household"]')).toHaveAttribute('aria-label', /900\.000/);
  await targets.nth(0).click();
  await expect(page).toHaveURL(/\/transactions\?.*account=/);
  await expect(page.getByTestId('transaction-row')).toHaveCount(1);
  await expect(page.getByTestId('transaction-row')).toContainText('Superindo');

  // The › in the header: the same chart on a screen of its own, every category named, and ‹ back to Cashflow.
  await page.goto('/transactions');
  await page.getByTestId('money-flow-open').click();
  await expect(page).toHaveURL(/\/transactions\/flow/);
  const screen = page.getByTestId('money-flow-page');
  await expect(screen).toBeVisible();
  await expect(screen.locator('[data-testid^="flow-target-"]')).toHaveCount(3);
  await expect(screen.locator('[data-testid^="flow-account-"][aria-label^="BCA Visa"]')).toBeVisible();
  await page.getByRole('link', { name: 'Cashflow' }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(box).toBeVisible();
});

test('a month with nothing in it draws no box', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await page.goto('/transactions');
  await expect(page.getByTestId('spending-report')).toBeVisible();
  await expect(page.getByTestId('money-flow')).toHaveCount(0);
});
