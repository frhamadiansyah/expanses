import { expect, test } from '@playwright/test';

test('a merchant taught here shows in the list, and the typical codes stay a table on a desktop', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));
  await page.goto('/cards/merchants');
  await expect(page.getByRole('heading', { name: 'Merchants & MCCs' })).toBeVisible();
  await page.getByLabel('Merchant text').fill('mcdonald');
  await page.getByLabel('MCC', { exact: true }).fill('5814');
  await page.getByRole('button', { name: 'Save merchant' }).click();
  await expect(page.getByText(/^Saved\./)).toBeVisible();
  await expect(page.getByRole('cell', { name: 'mcdonald', exact: true })).toBeVisible();
  await page.getByLabel('Search typical merchants').fill('mcdonald');
  await expect(page.getByRole('table')).toHaveCount(2);
  expect(crashes).toEqual([]);
});
