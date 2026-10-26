import { test } from '@playwright/test';
import { archiveAndRestore, deleteEmpty, deleteWithTransactions, refusePersonal } from './workspace-delete';

// The same walks as workspace-delete.spec.ts, on the phone shell (390 x 844).
test('phone: an empty workspace is deleted with one confirmation', async ({ page }) => {
  await page.goto('/account');
  await deleteEmpty(page);
});

test('phone: a workspace holding a transaction is deleted by typing its name, and the transaction goes with it', async ({ page }) => {
  await deleteWithTransactions(page);
});

test('phone: Personal cannot be deleted', async ({ page }) => {
  await page.goto('/account');
  await refusePersonal(page);
});

test('phone: Archive and Restore still work beside Delete', async ({ page }) => {
  await page.goto('/account');
  await archiveAndRestore(page);
});
