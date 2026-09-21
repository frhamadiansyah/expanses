import { expect, test } from '@playwright/test';

test('the three card screens draw at 390px without scrolling sideways', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(String(e)));

  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA KrisFlyer Visa Signature');
  await page.getByLabel('Type').selectOption('credit_card');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA KrisFlyer Visa Signature', exact: true })).toBeVisible();

  await page.goto('/cards');
  const card = page.getByRole('link', { name: 'BCA KrisFlyer Visa Signature', exact: true });
  await expect(card).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wide).toBe(false);

  await card.click();
  await expect(page.getByRole('heading', { name: 'BCA KrisFlyer Visa Signature' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Card sections' }).getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('radio', { name: 'Rules' })).toBeVisible();
  const wideCard = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wideCard).toBe(false);

  await page.goto('/cards/merchants');
  await expect(page.getByRole('heading', { name: 'Merchants & MCCs' })).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  const wideMerchants = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(wideMerchants).toBe(false);

  expect(crashes).toEqual([]);
});
