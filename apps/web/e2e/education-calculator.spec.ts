import { test } from '@playwright/test';
import { twoLevelsWalk } from './education-walk';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('two levels, a once fee and a yearly one, and a level added later raises the target', async ({ page }) => {
  await twoLevelsWalk(page);
});
