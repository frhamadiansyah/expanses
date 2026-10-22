import { expect, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset } from './add-asset';
import { openDrawers } from './drawers';
import { todayIn } from './today';

test('a bond’s coupon terms record each coupon due when the app opens, and Coupon opens on the next one', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '1000000' });
  await openNewAsset(page, 'Government bonds');
  await page.getByLabel('Name', { exact: true }).fill('Retail bond');
  await fillDay(page, 'Bought', await todayIn(page, 200));
  await page.getByLabel('Par value', { exact: true }).fill('10000000');
  await page.getByLabel('Purchase value', { exact: true }).fill('10000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(page);
  await page.getByRole('link', { name: /Retail bond/ }).click();
  const bondPage = page.url();

  // Rp10.000.000 at 6,3% a year, monthly: Rp52.500 a month, Rp47.250 after the 10% withheld. Two already due.
  await page.getByRole('main').getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('textbox', { name: 'Rate (% a year)' }).fill('6,3');
  await page.getByRole('textbox', { name: 'Rate (% a year)' }).blur();
  await page.getByRole('textbox', { name: 'Next payment on' }).fill(await todayIn(page, 40));
  await page.getByRole('combobox', { name: 'Paid into' }).selectOption({ label: 'BCA Tahapan' });
  await expect(page.getByRole('button', { name: 'Remove coupon terms' })).toBeVisible();

  // Opened again: the two coupons due are recorded, once each.
  await page.goto(bondPage);
  await page.reload();
  await expect(page.getByText('Rp 52.500').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /^Next coupon/ })).toContainText('47.250');
  await page.reload();
  await expect(page.getByRole('main').getByText(/Coupon|Income/).first()).toBeVisible();

  // Coupon opens on the next one, figures filled in.
  await page.getByRole('button', { name: 'Coupon', exact: true }).click();
  await expect(page.getByLabel('Amount before tax (IDR)')).toHaveValue(/52\.?500/);
  await expect(page.getByLabel('Tax withheld (IDR)')).toHaveValue(/5\.?250/);
});
