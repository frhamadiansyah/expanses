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

  // The ratios left the Overview for a screen of their own behind the gauge in the corner.
  await page.goto('/net-worth/health');
  // Rp 16 jt left in the bank against Rp 4 jt of one month's spending.
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Emergency fund', exact: true }) }).last();
  await expect(card).toContainText('4,0 months');
  // The screen is the switch and the tiles: no count of the months read; each tile keeps its one line on how it is worked out.
  await expect(page.getByText(/months? of transactions/)).toHaveCount(0);
  await expect(page.getByText('How the ratios are worked out')).toHaveCount(0);
  await expect(card).toContainText('Cash & equivalents ÷');

  // What the fund counts, the debt guide and each ratio's working are the Settings page behind the ⚙.
  await page.locator('header').getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/net-worth\/health\/settings$/);
  await expect(page.getByLabel('Debt servicing guide')).toHaveValue('3000');
  await expect(page.getByText('How the ratios are worked out')).toBeVisible();
  const base = page.getByRole('radiogroup', { name: 'Emergency fund counts' });
  await expect(base.getByRole('radio', { name: 'Essential spending' })).toHaveAttribute('aria-checked', 'true');
  await base.getByRole('radio', { name: 'All spending' }).click();
  await expect(base.getByRole('radio', { name: 'All spending' })).toHaveAttribute('aria-checked', 'true');

  // ‹ goes back to the tiles, which read the choice. Nothing is marked lifestyle, so the figure does not move.
  await page.getByRole('button', { name: 'Financial health' }).click();
  await expect(page).toHaveURL(/\/net-worth\/health$/);
  await expect(card).toContainText('4,0 months');
});
