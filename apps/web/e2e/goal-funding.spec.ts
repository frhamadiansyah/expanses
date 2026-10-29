import { test } from '@playwright/test';
import { fundingSheetWalk } from './goal-funding';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('the Funding sheet holds cash and tagged purchases on a new goal, and asks before moving a tagged buy', async ({ page }) => {
  await fundingSheetWalk(page);
});
