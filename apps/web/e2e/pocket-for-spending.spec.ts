import { test } from '@playwright/test';
import { pocketForSpending } from './pocket-for-spending';

test('a pocket switched off "For spending" leaves Paid with and Wallet, and Assets still counts it', async ({ page }) => {
  // A long walk: two pockets opened, both switches each way, and Wallet, Paid with and Assets read in between.
  test.setTimeout(180_000);
  await pocketForSpending(page);
});
