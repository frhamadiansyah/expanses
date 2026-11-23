import { test } from '@playwright/test';
import { everyPocketOff, pocketForSpending } from './pocket-for-spending';
import { macV2 } from './mac-detail';

test('a pocket switched off "For spending" leaves Paid with and Wallet, and Assets still counts it', async ({ page }) => {
  // A long walk: two pockets opened, both switches each way, and Wallet, Paid with and Assets read in between.
  test.setTimeout(180_000);
  // Reads Wallet's Balance box, a v2 part of Mac Wallet.
  await macV2(page);
  await pocketForSpending(page);
});

test('every pocket switched off reads the account off, and switching it on brings both back', async ({ page }) => {
  test.setTimeout(180_000);
  // Reads Wallet's Balance box, a v2 part of Mac Wallet.
  await macV2(page);
  await everyPocketOff(page);
});
