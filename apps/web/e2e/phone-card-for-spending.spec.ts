import { test } from '@playwright/test';
import { cardForSpending } from './card-for-spending';

test('by thumb: a credit card switched off For spending leaves Wallet and Paid with, and stays on Debts and its own page', async ({ page }) => {
  test.setTimeout(120_000);
  await cardForSpending(page);
});
