import { test } from '@playwright/test';
import { eyeHidesBalance, forSpendingOff } from './wallet';

test('an account switched off For spending leaves Wallet and Paid with, and stays on Assets and in a transfer’s To', async ({ page }) => {
  await forSpendingOff(page);
});

test('the eye hides the Balance box, the stack moves up, and the choice outlives a reload', async ({ page }) => {
  await eyeHidesBalance(page);
});
