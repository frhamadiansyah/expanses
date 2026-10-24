import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';

/*
 * Opening balances are how the books were started, not money that moved: out of the list, and the ⋯ menu no longer
 * offers to show them (2026-10-24). Nothing else on the page mentions them either.
 */
test('opening balances stay out of the list, and the menu no longer offers to show them', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  const opening = page.getByTestId('transaction-row').filter({ hasText: 'Opening balance' });
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  await expect(opening).toHaveCount(0);

  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Show opening balances' })).toHaveCount(0);
  await expect(page.getByText('Show opening balances')).toHaveCount(0);

  await page.reload();
  await expect(opening).toHaveCount(0);
});
