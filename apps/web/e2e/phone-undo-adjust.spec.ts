import { expect, test } from '@playwright/test';
import { openAccount, showBalance, walletCard } from './accounts';

/*
 * Adjust balance posts one transaction for the difference. "Just a correction" files it against the balance-correction
 * account: no Edit, but it can be deleted from its receipt (and by swipe), which puts the balance back.
 */
test('by thumb: a balance correction is deleted from its receipt and the balance comes back', async ({ page }) => {
  await openAccount(page, { subtype: 'cash', name: 'Pocket cash', balance: '932500' });
  await walletCard(page, 'Pocket cash').tap();
  await page.getByRole('button', { name: 'Adjust', exact: true }).tap();
  const count = page.getByRole('dialog', { name: 'Adjust balance' });
  await count.getByLabel('Actual').fill('887500');
  await count.getByRole('radio', { name: /Just a correction/ }).check();
  await count.getByRole('button', { name: 'Save' }).tap();
  await expect(count).toHaveCount(0);
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('887.500');

  await page.getByTestId('account-recent-row').first().tap();
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).not.toHaveURL(/\/transactions\/[^/]+$/);
  await page.goto('/wallet');
  await walletCard(page, 'Pocket cash').tap();
  await showBalance(page);
  await expect(page.getByTestId('balance-card')).toContainText('932.500');
});
