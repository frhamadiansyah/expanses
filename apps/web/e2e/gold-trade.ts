import { expect, type Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addPriced, openAsset, typePrice } from './asset-page';

export const GOLD = 'UBS gold bars';

/** A bank with money in it, and 12 g of UBS bars that cost Rp 22.500.000, today's price typed as 1.950.000 a gram. */
export async function goldAtPrice(page: Page) {
  await page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
  await openAccount(page, { subtype: 'bank', name: 'BCA', balance: '30000000' });
  await addPriced(page, 'Gold bullion', GOLD, [['2025-09-19', '12', '22500000']]);
  await openAsset(page, GOLD);
  await typePrice(page, '1950000');
  await expect(page.getByTestId('asset-grid')).toContainText('12 g');
}
