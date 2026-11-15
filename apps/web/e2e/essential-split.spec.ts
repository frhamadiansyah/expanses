import { test } from '@playwright/test';
import { checkBudgetBox, checkGuideSheet, checkHealthCard, checkIncomePage, seedMonth } from './essential-split';

test('Essential · Lifestyle · Debts & savings on Cashflow, the guide, Budget and Financial health', async ({ page }) => {
  test.setTimeout(180_000);
  await seedMonth(page);
  await checkIncomePage(page);
  await checkHealthCard(page);
  await checkGuideSheet(page);
  await checkBudgetBox(page);
});
