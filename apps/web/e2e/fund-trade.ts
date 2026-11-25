import { expect, type Locator, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset, pastPurchase } from './add-asset';
import { openAsset } from './asset-page';

export const FUND = 'Sucorinvest Money Market Fund';

/**
 * The owner's own example (spec 2026-10-19-fund-by-amount): a bank with money in it, and a money market fund bought
 * through Add asset for Rp 1.000.000 with no units, then its value typed as the fund app shows it, Rp 1.052.000. Its
 * page is left open.
 */
export async function fundByMoney(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '10000000' });
  await openNewAsset(page, 'Mutual fund');
  await page.getByLabel('Name', { exact: true }).fill(FUND);
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-01-15');
  await expect(page.getByLabel('Units', { exact: true })).toHaveAttribute('placeholder', 'Optional');
  await page.getByLabel('Amount', { exact: true }).fill('1000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await openAsset(page, FUND);
  await expect(page.getByTestId('asset-grid')).toContainText('Money inRp');
  await page.getByRole('button', { name: 'Value', exact: true }).click();
  await page.getByLabel('Value', { exact: true }).fill('1052000');
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(page.getByTestId('asset-card')).toContainText('1.052.000');
}

/** The holding page's Institution row: a fund's or bond's broker cash account, or a place typed by name. */
export const institutionRow = (page: Page): Locator => page.getByTestId('institution-row');

/**
 * Sets a fund's or bond's Institution from its page: a broker's cash account picked from the list, a place with no
 * account typed under Other place…, or None. Waits for the row to say it.
 */
export async function setInstitution(page: Page, place: { broker: string } | { other: string } | 'none') {
  await institutionRow(page).getByRole('button').click();
  const sheet = page.getByRole('dialog', { name: 'Institution', exact: true });
  if (place === 'none') {
    await sheet.getByRole('button', { name: 'None', exact: true }).click();
    await expect(institutionRow(page)).toContainText('Not set');
    return;
  }
  if ('broker' in place) {
    // Named by the account, with its RDN bank under it when it has one.
    await sheet.getByRole('button', { name: new RegExp(`^${place.broker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).first().click();
    await expect(institutionRow(page)).toContainText(place.broker);
    return;
  }
  await sheet.getByRole('button', { name: /^Other place/ }).click();
  const other = page.getByRole('dialog', { name: 'Other place', exact: true });
  await other.getByLabel('Name', { exact: true }).fill(place.other);
  await other.getByRole('button', { name: 'Save place' }).click();
  await expect(other).toHaveCount(0);
  await expect(institutionRow(page)).toContainText(place.other);
}
