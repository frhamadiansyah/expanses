import { test } from '@playwright/test';
import { fundedByTwoTaps } from './funded-by-taps';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

test('phone: a set-aside line opens Set aside from its body and the account from its own ›; the gold row is one target', async ({ page }) => {
  await fundedByTwoTaps(page);
});
