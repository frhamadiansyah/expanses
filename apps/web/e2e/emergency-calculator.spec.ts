import { expect, test } from '@playwright/test';
import { addTransaction } from './add-transaction';
import { openGoalForm } from './goals';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('two answers prefill the months, say why, and size the goal on a month of spending', async ({ page }) => {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await page.getByLabel('Current balance').fill('20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '1000000' });

  await page.goto('/goals');
  await openGoalForm(page, 'Emergency fund');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('button', { name: 'Move Emergency fund down' })).toBeVisible();
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByLabel('Household').selectOption('children');
  await page.getByLabel('Income').selectOption('irregular');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('24');
  // The two answers above are what set it, so the row does not repeat them back as a hint.
  await expect(page.getByText(/with children, freelance/)).toHaveCount(0);
  // A figure of your own is the one case it does explain.
  await page.getByLabel('Months of outgoings').fill('30');
  await expect(page.getByText('Your own figure · the guide is 24')).toBeVisible();
  await page.getByLabel('Months of outgoings').fill('24');
  // The goal's base is its own, and the page says so: the ratio card on Net worth has a switch of its own.
  await expect(page.getByText('For this goal only; the emergency ratio on Net worth has its own switch.')).toBeVisible();
  await page.getByRole('button', { name: 'Use this amount' }).click();

  // 24 months of Rp 1.000.000 at 0% growth: exactly Rp 24.000.000.
  await expect(page.locator('body')).toContainText('24.000.000');
});
