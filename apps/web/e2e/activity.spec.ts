import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';

test('Settings has Activity: empty at first, then a new purchase that Undo takes away', async ({ page }) => {
  // On a wide screen Activity is a section of Settings (Mac Settings A); its address is the phone's page too.
  await page.goto('/account');
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Activity' }).click();
  await expect(page).toHaveURL(/\/account\?section=activity$/);
  await expect(page.getByTestId('settings-activity').getByText('Nothing changed yet')).toBeVisible();

  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi susu', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '45000' });
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi susu' })).toHaveCount(1);

  await page.goto('/settings/activity');
  const added = page.getByTestId('activity-line').filter({ hasText: 'Kopi susu added' });
  await expect(added).toContainText('BCA Tahapan');
  await added.getByTestId('activity-undo').click();
  await expect(page.getByTestId('activity-line').filter({ hasText: 'Undone: Kopi susu add' })).toBeVisible();

  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Kopi susu' })).toHaveCount(0);
});
