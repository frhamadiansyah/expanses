import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';

test('opening balances are out of the list until the menu shows them, and the choice is remembered', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '5000000' });
  await page.goto('/transactions');
  const opening = page.getByTestId('transaction-row').filter({ hasText: 'Opening balance' });
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible();
  await expect(opening).toHaveCount(0);

  await page.getByRole('button', { name: 'Filters', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Show opening balances' }).click();
  await expect(opening).toHaveCount(1);

  await page.reload();
  await expect(opening).toHaveCount(1);
});
