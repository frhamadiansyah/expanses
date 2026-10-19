import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset } from './add-asset';
import { openAsset } from './asset-page';

export const FUND = 'Sucorinvest Money Market Fund';

/**
 * The owner's own example (spec 2026-10-19-fund-by-amount): a bank with money in it, and a money market fund bought
 * through Add asset for Rp 1.000.000 with no units, then its value typed as the fund app shows it, Rp 1.052.000. Its
 * page is left open.
 */
export async function fundByMoney(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '10000000' });
  await openNewAsset(page, 'Mutual fund (reksadana)');
  await page.getByLabel('Name', { exact: true }).fill(FUND);
  await fillDay(page, 'Bought', '2026-01-15');
  await expect(page.getByLabel('Units', { exact: true })).toHaveAttribute('placeholder', 'Optional');
  await page.getByLabel('Amount', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await openAsset(page, FUND);
  await expect(page.getByTestId('asset-grid')).toContainText('Money inRp');
  await page.getByRole('button', { name: 'Update value' }).click();
  await page.getByLabel('Value (IDR)').fill('1052000');
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(page.getByTestId('asset-card')).toContainText('1.052.000');
}
