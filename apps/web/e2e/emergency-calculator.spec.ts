import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { openGoalForm, openWorking } from './goals';
import { goalCard } from './set-aside';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('two answers prefill the months, say why, and size the goal on a month of spending', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '1000000' });

  await page.goto('/goals');
  await openGoalForm(page, 'Emergency fund');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  // The goal's own page carries its fields and its working; the save lands as a row on the list.
  await goalCard(page, 'Emergency fund');
  await openWorking(page);
  await page.getByLabel('Household').selectOption('children');
  await page.getByLabel('Income').selectOption('irregular');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('24');
  // The two answers above are what set it, so the row does not repeat them back as a hint.
  await expect(page.getByText(/with children, freelance/)).toHaveCount(0);
  // A figure of your own is the one case it does explain.
  await page.getByLabel('Months of outgoings').fill('30');
  await expect(page.getByText('Custom figure · the guide is 24')).toBeVisible();
  await page.getByLabel('Months of outgoings').fill('24');
  // The goal's calculator reads like the standalone one, and opens on what the goal already uses a month.
  await expect(page.getByLabel('What goes out a month', { exact: true })).toHaveValue('1.000.000');
  await expect(page.getByLabel('Save it over (months)')).toBeVisible();
  await expect(page.getByLabel('Counts', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Save goal' }).click();

  // 24 months of Rp 1.000.000 at 0% growth: exactly Rp 24.000.000.
  await expect(page.locator('body')).toContainText('24.000.000');
});

test('changing What goes out a month changes the goal’s target on its page', async ({ page }) => {
  await page.goto('/goals');
  await openGoalForm(page, 'Emergency fund');
  await page.getByRole('button', { name: 'Save goal' }).last().click();
  await goalCard(page, 'Emergency fund');
  await openWorking(page);
  await page.getByLabel('Months of outgoings').fill('6');
  await page.getByLabel('What goes out a month', { exact: true }).fill('2500000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  // Six months of the typed Rp 2.500.000, whatever the records say.
  await expect(page.getByTestId('goal-target')).toContainText('15.000.000');

  await openWorking(page);
  await expect(page.getByLabel('What goes out a month', { exact: true })).toHaveValue('2.500.000');
  await page.getByLabel('What goes out a month', { exact: true }).fill('3000000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  await expect(page.getByTestId('goal-target')).toContainText('18.000.000');
});

test('a second working updates the Emergency fund instead of starting another', async ({ page }) => {
  await page.goto('/calculators/emergency');
  await page.getByLabel('What goes out a month', { exact: true }).fill('10000000');
  await expect(page.getByRole('button', { name: 'Update goal' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Set a goal' }).click();
  const added = page.getByRole('alertdialog', { name: 'Added to Goals' });
  await expect(added).toContainText('Emergency fund');
  await added.getByRole('button', { name: 'Done' }).click();

  // The same fund now: the row says Update goal, and the pop-up says it was updated.
  await page.getByLabel('What goes out a month', { exact: true }).fill('12000000');
  await expect(page.getByRole('button', { name: 'Set a goal' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Update goal' }).click();
  const updated = page.getByRole('alertdialog', { name: 'Goal updated' });
  await expect(updated).toContainText('Emergency fund');
  await updated.getByRole('button', { name: 'Open goal' }).click();
  await expect(page).toHaveURL(/\/goals\/[^/]+$/);
  await expect(page.getByTestId('goal-target')).toContainText('Rp');

  await page.goto('/goals');
  await expect(page.getByRole('link', { name: /Emergency fund/ })).toHaveCount(1);
});
