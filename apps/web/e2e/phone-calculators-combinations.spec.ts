import { test } from '@playwright/test';
import { row1, row5, row8 } from './calculator-walk';

/** The calculator combinations at phone width: rows 1, 5 and 8. */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('row 1 at phone width — no birthday: 65 jt, then 20 jt five times, each due on 1 January', async ({ page }) => {
  await row1(page);
});

test('row 5 at phone width — a paid stage keeps its mark, and the target rises by exactly the new level', async ({ page }) => {
  await row5(page);
});

test('row 8 at phone width — life cover with more than enough: no further cover, and the surplus', async ({ page }) => {
  await row8(page);
});
