import { expect, type Locator, type Page, test } from '@playwright/test';
import { fundByMoney } from './fund-trade';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

/** Whether the whole of `row` is above the keypad's top edge, so nothing of it is under the dock. */
async function clearOfKeypad(page: Page, row: Locator) {
  const keypad = await page.getByTestId('keypad').boundingBox();
  const box = await row.boundingBox();
  if (!keypad || !box) throw new Error('keypad or row not drawn');
  return { rowBottom: Math.round(box.y + box.height), keypadTop: Math.round(keypad.y), clear: box.y + box.height <= keypad.y + 0.5 };
}

test('phone: the keypad never covers the amount it types into, in a sheet that stands at half height', async ({ page }) => {
  await fundByMoney(page);
  await page.getByRole('button', { name: 'Buy', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const amount = sheet.getByLabel('Amount', { exact: true });
  await amount.click();
  await expect(page.getByTestId('keypad')).toBeVisible();
  // The sheet makes room for the dock, as it does for the keyboard: it stands at large and the field is scrolled clear.
  await expect.poll(async () => (await clearOfKeypad(page, amount)).clear).toBe(true);
  // The rows under it can be scrolled above the dock too: the sheet's own list runs on under the keys.
  // Scrolled to its foot, the last row of the form stands above the dock rather than under it.
  await sheet.evaluate((panel) => panel.scrollTo(0, panel.scrollHeight));
  const toggle = sheet.getByRole('button', { name: 'Add more details' });
  await expect.poll(async () => (await clearOfKeypad(page, toggle)).clear).toBe(true);
  // Typed figures still land, and DONE puts the dock away and the sheet back.
  const keypad = page.getByTestId('keypad');
  for (const digit of '25000') await keypad.getByRole('button', { name: digit, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await expect(keypad).toHaveCount(0);
  await expect(amount).toContainText('25.000');
});
