import { expect, test } from '@playwright/test';

test('a merchant added from + shows in Mine, both lists stay tables on a desktop, and a typical code can be ignored and forgotten', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  await page.goto('/cards/merchants');
  await expect(page.getByRole('heading', { name: 'Merchants', exact: true })).toBeVisible();
  // The way back is the round ‹, named for where it goes and wearing no word of its own.
  const back = page.getByRole('main').getByRole('link', { name: 'Wallet', exact: true }).filter({ hasNotText: /\w/ });
  await expect(back).toBeVisible();

  // + opens the New merchant sheet; ✓ saves.
  await page.getByRole('button', { name: 'New merchant' }).click();
  const sheet = page.getByRole('dialog', { name: 'New merchant' });
  await sheet.getByLabel('Name in purchases').fill('Warung Bunda');
  await sheet.getByLabel('MCC', { exact: true }).fill('5814');
  await sheet.getByRole('button', { name: 'Save merchant' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'warung bunda', exact: true })).toBeVisible();

  // Search takes the title's row and filters both lists, here by the code.
  await page.getByRole('button', { name: 'Search merchants' }).click();
  await page.getByRole('searchbox', { name: 'Search merchants' }).fill('5814');
  await expect(page.getByRole('table')).toHaveCount(2);
  await page.getByRole('searchbox', { name: 'Search merchants' }).fill('warung');
  await expect(page.getByRole('table')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByRole('heading', { name: 'Merchants', exact: true })).toBeVisible();

  // A typical merchant opened from its row: Use typical code off ignores it, and it joins Mine as Ignored.
  const mcd = page.getByRole('row').filter({ hasText: '“mcdonald”' });
  await mcd.getByRole('button', { name: 'Use a different MCC' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByLabel('Use typical code')).toBeChecked();
  await edit.getByLabel('Use typical code').uncheck({ force: true });
  await expect(edit.getByLabel('MCC', { exact: true })).toHaveCount(0);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit).toHaveCount(0);
  const ignored = page.getByRole('row').filter({ hasText: 'Ignored: the typical MCC is not used' });
  await expect(ignored.getByRole('cell', { name: 'mcdonald', exact: true })).toBeVisible();

  // Forgotten from its sheet, it goes back to the typical code.
  await ignored.getByRole('button', { name: 'Edit' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('dialog').getByRole('button', { name: 'Forget this merchant' }).click();
  await expect(page.getByRole('cell', { name: 'mcdonald', exact: true })).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '“mcdonald”' })).toContainText('Typical');
  expect(crashes).toEqual([]);
});
