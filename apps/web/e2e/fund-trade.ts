import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addPriced, openAsset, typePrice } from './asset-page';

export const FUND = 'Sucorinvest Money Market Fund';

/**
 * A bank with money in it, and a money market fund bought through Add asset: 1.356,2481 units that cost Rp 2.450.000,
 * its NAV today typed as 1.843,2715. Its page is left open.
 */
export async function fundAtNav(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '10000000' });
  await addPriced(page, 'Mutual fund (reksadana)', FUND, [['2026-01-15', '1356,2481', '2450000']]);
  await openAsset(page, FUND);
  await typePrice(page, '1.843,2715');
  await expect(page.getByTestId('asset-grid')).toContainText('1.356,2481');
}
