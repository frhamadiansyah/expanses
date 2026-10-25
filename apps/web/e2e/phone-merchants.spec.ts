import { expect, test } from '@playwright/test';

test('Merchants on a phone: round ‹, search in the title row, + and a row both open the sheet, and a typical code ignored shows in Mine', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  await page.goto('/cards/merchants');
  const title = page.getByRole('heading', { name: 'Merchants', exact: true });
  await expect(title).toBeVisible();

  // The way back is the round ‹ at the left, with no word beside it, and the name centred in the same row — as Points and a bill read.
  const back = page.getByRole('main').getByRole('link', { name: 'Wallet', exact: true }).filter({ hasNotText: /\w/ });
  await expect(back).toBeVisible();
  const [backBox, titleBox, plusBox] = [(await back.boundingBox())!, (await title.boundingBox())!, (await page.getByRole('button', { name: 'New merchant' }).boundingBox())!];
  expect(backBox.width).toBeGreaterThanOrEqual(44);
  expect(titleBox.y).toBeLessThan(backBox.y + backBox.height);
  expect(titleBox.y + titleBox.height).toBeGreaterThan(backBox.y);
  expect(Math.abs(plusBox.y - backBox.y)).toBeLessThanOrEqual(1);
  await expect(page.getByText('‹ Wallet')).toHaveCount(0);
  // No form is open on the page itself.
  await expect(page.getByLabel('Merchant', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('table')).toHaveCount(0);

  // + opens New merchant: Merchant, then one MCC row reading Choose.
  await page.getByRole('button', { name: 'New merchant' }).click();
  const sheet = page.getByRole('dialog', { name: 'New merchant' });
  await expect(sheet.getByLabel('Merchant', { exact: true })).toHaveAttribute('placeholder', 'Name');
  await sheet.getByLabel('Merchant', { exact: true }).fill('Warung Bunda');
  await expect(sheet.getByText(/whole words|purchases? match/)).toHaveCount(0);
  await expect(sheet.getByText('Find an MCC by name')).toHaveCount(0);
  const mccRow = sheet.getByRole('button', { name: /^MCC/ });
  await expect(mccRow).toHaveText(/^MCC\s*Choose/);

  // The row opens a step with ‹ back to the merchant; four digits the list lacks can still be used, with a warning.
  await mccRow.click();
  const step = page.getByRole('dialog', { name: 'MCC' });
  const find = step.getByRole('textbox', { name: 'Find an MCC' });
  await expect(find).toBeFocused();
  await find.fill('0001');
  await step.getByRole('button', { name: /^Use 0001/ }).click();
  await expect(mccRow).toContainText('0001');
  await expect(mccRow).toContainText('Not in the MCC list');

  // Digits pick a code directly: typed whole and Enter, or tapped from the codes they start.
  await mccRow.click();
  await step.getByRole('textbox', { name: 'Find an MCC' }).fill('5999');
  await step.getByRole('textbox', { name: 'Find an MCC' }).press('Enter');
  await expect(mccRow).toContainText('5999');
  await mccRow.click();
  await step.getByRole('textbox', { name: 'Find an MCC' }).fill('5814');
  await step.getByRole('button', { name: /Fast Food Restaurants/ }).click();
  await expect(mccRow).toContainText('5814');
  await expect(mccRow).toContainText('Fast Food Restaurants');

  // ‹ goes back without changing the code, and the name typed is still there.
  await mccRow.click();
  await step.getByRole('button', { name: 'New merchant' }).click();
  await expect(sheet.getByLabel('Merchant', { exact: true })).toHaveValue('Warung Bunda');
  await expect(mccRow).toContainText('5814');
  await sheet.getByRole('button', { name: 'Save merchant' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('merchant-warung bunda')).toContainText('5814 · Fast Food Restaurants · 0 purchases');

  // Search takes the whole title row — no ‹ in it — and filters Mine and Typical codes alike.
  await page.getByRole('button', { name: 'Search merchants' }).click();
  const field = page.getByRole('searchbox', { name: 'Search merchants' });
  await expect(field).toBeFocused();
  await expect(back).toHaveCount(0);
  await field.fill('warung');
  await expect(page.getByTestId('merchant-warung bunda')).toBeVisible();
  await expect(page.getByText("McDonald's", { exact: true })).toHaveCount(0);
  await field.fill('mcdonald');
  await expect(page.getByTestId('merchant-warung bunda')).toHaveCount(0);
  await expect(page.getByText("McDonald's", { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(title).toBeVisible();
  await expect(back).toBeVisible();

  // A typical row opens the same sheet under its own name; Use typical code off makes it Ignored, in Mine.
  await page.getByText("McDonald's", { exact: true }).click();
  const mcd = page.getByRole('dialog', { name: "McDonald's" });
  await expect(mcd.getByLabel('Merchant', { exact: true })).toHaveValue('mcdonald');
  await expect(mcd.getByRole('button', { name: /^MCC/ })).toContainText('5814');
  await mcd.getByLabel('Use typical code').uncheck({ force: true });
  await mcd.getByRole('button', { name: 'Save changes' }).click();
  await expect(mcd).toHaveCount(0);
  await expect(page.getByTestId('merchant-mcdonald')).toContainText('Typical code ignored');
  await expect(page.getByTestId('merchant-mcdonald')).toContainText('Ignored');

  // Opened from Mine, it can be forgotten.
  await page.getByTestId('merchant-mcdonald').click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('dialog', { name: "McDonald's" }).getByRole('button', { name: 'Forget this merchant' }).click();
  await expect(page.getByTestId('merchant-mcdonald')).toHaveCount(0);

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
  expect(crashes).toEqual([]);
});
