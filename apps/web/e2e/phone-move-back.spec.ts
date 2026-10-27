import { expect, test } from '@playwright/test';
import { walletCard } from './accounts';
import { mockRates, openWithPockets } from './pockets';

test('by thumb: Move, back to the account, then ✕ lands on Wallet, not on Move again', async ({ page }) => {
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, { name: 'Valas Plus', pockets: [{ currency: 'USD', balance: '2400.00', rate: '16250' }, { currency: 'SGD', balance: '1150.00' }] });
  await walletCard(page, 'Valas Plus').tap();
  await page.getByRole('link', { name: 'Move', exact: true }).tap();
  await expect(page).toHaveURL(/\/accounts\/[^/]+\/move$/);
  await page.screenshot({ path: '/private/tmp/claude-501/-Users-frhamadiansyah-Documents-Projects-Expanses/17ecd7cc-b713-4f21-b1a9-9a90ded56208/scratchpad/move2.png' });
  await page.getByRole('button', { name: 'Valas Plus' }).first().tap();
  await expect(page).toHaveURL(/\/accounts\/[^/]+$/);
  await page.getByRole('button', { name: 'Close', exact: true }).tap();
  await expect(page).toHaveURL(/\/wallet$/);
});
