import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { setBudget } from './budget';
import { openGoalForm } from './goals';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function spendOnDinner(page: Page, amount: string) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Checking', balance: '20000000' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Checking', category: 'Restaurants', amount: amount });
  await expect(page.getByText('Warung Steak')).toBeVisible();
}

test('a cap on a parent counts what its children spent', async ({ page }) => {
  await spendOnDinner(page, '500000');

  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '300000');

  // 500.000 spent under Restaurants against a 300.000 cap on the parent.
  await expect(page.getByTestId('line-Food and beverage')).toContainText('Over by');
  await expect(page.getByTestId('line-Food and beverage')).toContainText('200.000');
});

test('leaving the category box untouched refuses to save, rather than capping the wrong one', async ({ page }) => {
  await page.goto('/budget');

  // The user never opens the Category box — it must still read as unset, not silently matched to
  // whatever option a blank value happens to fall on.
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('');
  await page.getByLabel('Monthly amount (IDR)').fill('300000');
  await page.getByRole('button', { name: 'Set budget' }).click();

  // The bug: falling through to the first option by sort order silently put the cap on Utilities, a
  // category the user never chose. The refusal is synchronous (it throws before any write), so wait
  // for it first — checking the row before that would race a write that, under the fix, never starts.
  await expect(page.getByRole('alert')).toContainText('Choose a category');

  // Nothing should be capped at all, least of all Utilities — read only the row's own text (not its
  // children's, which say "No budget" regardless and would mask a bad cap sitting on the parent).
  const utilitiesOwnText = page.getByTestId('line-Utilities').locator(':scope > div');
  await expect(utilitiesOwnText).toContainText('No budget');
  await expect(page.getByTestId('caps-total')).toContainText('Rp 0');
});

test('every spending category appears, capped or not', async ({ page }) => {
  await page.goto('/budget');

  await expect(page.getByTestId('line-Personal care')).toBeVisible();
  await expect(page.getByTestId('line-Personal care')).toContainText('No budget');
});

test('an override changes one month and leaves the next alone', async ({ page }) => {
  await page.goto('/budget');
  await setBudget(page, 'Food and beverage', '1000000');
  await expect(page.getByTestId('line-Food and beverage')).toContainText('1.000.000');

  await setBudget(page, 'Food and beverage', '9000000', true);
  await expect(page.getByTestId('line-Food and beverage')).toContainText('9.000.000');
  await expect(page.getByTestId('line-Food and beverage')).toContainText('just this month');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('line-Food and beverage')).toContainText('1.000.000');
  await expect(page.getByTestId('line-Food and beverage')).not.toContainText('just this month');
});

test('the sheet plans against typed income and reports what happened', async ({ page }) => {
  await page.goto('/budget');
  await page.getByLabel('Expected take-home (IDR)').fill('25000000');
  await page.getByRole('button', { name: 'Set income' }).click();
  await setBudget(page, 'Food and beverage', '5000000');

  await expect(page.getByTestId('income-line')).toContainText('25.000.000');
  // Nothing earned or spent yet, so the plan has 20 juta left and the month itself has nothing.
  await expect(page.getByTestId('left-over-plan')).toContainText('20.000.000');
  await expect(page.getByTestId('left-over-actual')).toContainText('0');
});

test('a goal becomes a savings row on the sheet', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Education');
  await page.getByLabel('Name', { exact: true }).fill('School fees');
  await page.getByLabel(/Cost in today's money/).first().fill('120000000');
  await page.getByLabel('Needed by').first().fill('2030-06-30');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByTestId('goal-row').filter({ hasText: 'School fees' }).first()).toBeVisible();

  await page.goto('/budget');
  await expect(page.getByTestId('savings-School fees')).toContainText('a month');
});
