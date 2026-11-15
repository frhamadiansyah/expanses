import { test } from '@playwright/test';
import { checkBudgetBox, checkGuideSheet, checkHealthCard, checkIncomePage, seedMonth } from './essential-split';

// Screenshots at 390 px go beside the mockups they were built from.
const SHOTS = '../../docs/mockups/2026-11-16-elf-built';

test('by thumb: Essential · Lifestyle · Debts & savings on Cashflow, the guide, Budget and Financial health', async ({ page }) => {
  test.setTimeout(180_000);
  await seedMonth(page);
  await checkIncomePage(page, `${SHOTS}-income.png`);
  await checkHealthCard(page, `${SHOTS}-health.png`);
  await checkGuideSheet(page, `${SHOTS}-guide.png`);
  await checkBudgetBox(page, `${SHOTS}-budget.png`);
});
