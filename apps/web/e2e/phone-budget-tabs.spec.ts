import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { setBudget } from './budget';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('on a phone: Spending first, Plan a tap away, a row opens its cap, and No budget lists the rest', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Grab', paidWith: 'BCA Tahapan', category: 'Ride hailing', amount: '120000' });
  await addTransaction(page, { description: 'Kopi', paidWith: 'BCA Tahapan', category: 'Personal care', amount: '80000' });

  await page.goto('/budget');
  // Opens on Spending, the month named between its arrows.
  await expect(page.getByRole('radio', { name: 'Spending' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('budget-month')).toHaveText(/\w+ \d{4}/);
  await setBudget(page, 'Transportation', '1000000');

  const card = page.getByTestId('left-to-spend');
  await expect(card).toContainText('Rp 880.000');
  await expect(card).toContainText('Spent Rp 120.000 of Rp 1.000.000');
  await expect(card).toContainText('days left');

  // A capped row: what is left, of what. It opens the cap sheet: ✕ · its name · ✓.
  const row = page.getByTestId('line-Transportation');
  await expect(row).toContainText('left of 1.000.000');
  await row.tap();
  const sheet = page.getByRole('dialog', { name: 'Transportation' });
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('1.000.000');
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveAttribute('placeholder', 'Amount');
  await expect(sheet.getByLabel('Every')).toHaveValue('monthly');
  await expect(sheet.getByLabel('Just this month')).not.toBeChecked();
  await expect(sheet.getByTestId('cap-spent')).toContainText('120.000');
  await expect(sheet.getByRole('button', { name: 'Remove budget' })).toBeVisible();
  await sheet.getByRole('button', { name: 'Close' }).tap();

  // What no cap covers is one row, opening the list of it.
  const noBudget = page.getByTestId('no-budget');
  await expect(noBudget).toContainText('80.000');
  await noBudget.tap();
  const list = page.getByRole('dialog', { name: 'No budget' });
  await expect(list.getByTestId('uncapped-Personal care')).toContainText('80.000');
  await list.getByTestId('uncapped-Personal care').tap();
  // An uncapped category has nothing to remove and nothing to change for one month.
  const fresh = page.getByRole('dialog', { name: 'Personal care' });
  await expect(fresh.getByLabel('Cap', { exact: true })).toHaveValue('');
  await expect(fresh.getByRole('button', { name: 'Remove budget' })).toHaveCount(0);
  await expect(fresh.getByLabel('Just this month')).toHaveCount(0);
  await fresh.getByRole('button', { name: 'Close' }).tap();

  // Plan: the take-home card, the rows that divide it, the ⓘ behind Debt payments.
  await page.getByRole('radio', { name: 'Plan' }).tap();
  await expect(page.getByTestId('take-home-card')).toContainText('Take-home');
  await expect(page.getByTestId('caps-total')).toContainText('1.000.000');
  await page.getByRole('button', { name: 'About Debt payments' }).tap();
  await expect(page.getByText('Loans and instalments are paid first')).toBeVisible();

  // Nothing on the page says "you".
  await expect(page.getByTestId('budget-page')).not.toContainText(/\byour?\b/i);
});
