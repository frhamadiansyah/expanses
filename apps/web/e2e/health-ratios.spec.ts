import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the emergency card divides cash by a month of spending, and the debt guide starts at 30%', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '4000000' });

  await page.goto('/net-worth');
  // Rp 16 jt left in the bank against Rp 4 jt of one month's spending.
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Emergency fund', exact: true }) }).last();
  await expect(card).toContainText('4,0 months');
  await expect(page.getByLabel('Debt servicing guide')).toHaveValue('3000');
  const base = page.getByRole('radiogroup', { name: 'Emergency fund counts' });
  await expect(base.getByRole('radio', { name: 'Essential spending' })).toHaveAttribute('aria-checked', 'true');
  await base.getByRole('radio', { name: 'All spending' }).click();
  await expect(base.getByRole('radio', { name: 'All spending' })).toHaveAttribute('aria-checked', 'true');
  // Nothing is marked lifestyle, so the figure does not move.
  await expect(card).toContainText('4,0 months');
});
