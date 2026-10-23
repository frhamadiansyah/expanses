import { expect, type Page, test } from '@playwright/test';
import { fillDay, openNewAsset } from './add-asset';
import { openAsset } from './asset-page';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

const MONEY_MARKET = 'Money Market Fund';
const BOND = 'Bond Fund';

/** A fund tracked by money through Add asset: bought for an amount with no units, on a day. */
async function addFund(page: Page, name: string, amount: string) {
  await openNewAsset(page, 'Mutual fund');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await fillDay(page, 'Bought', '2026-02-02');
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
}

// Invented figures: 8.000.000 into a money market fund the fund app now shows at 10.000.000, and 2.000.000 into a bond
// fund with no value typed. Switching 5.000.000 takes half the value, so half the 8.000.000 put in goes with it.
test('Switch 5.000.000 from one fund into another: both histories show it, and the two still add up', async ({ page }) => {
  await addFund(page, MONEY_MARKET, '8000000');
  await addFund(page, BOND, '2000000');
  await openAsset(page, MONEY_MARKET);
  await page.getByRole('button', { name: 'Value', exact: true }).click();
  await page.getByLabel('Value (IDR)').fill('10000000');
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(page.getByTestId('asset-card')).toContainText('10.000.000');

  await page.getByRole('button', { name: 'Switch', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByTestId('trade-holding')).toContainText(MONEY_MARKET);
  await expect(sheet.getByTestId('trade-holding')).toContainText('Value now Rp 10.000.000');
  await expect(page.getByRole('button', { name: 'Record switch' })).toBeDisabled();
  await expect(sheet.getByLabel('Fund', { exact: true })).toHaveValue(/.+/);
  await expect(sheet.getByLabel('Fund', { exact: true }).locator('option:checked')).toHaveText(BOND);

  // More than it is worth is refused before anything is saved.
  const amount = sheet.getByLabel('Amount', { exact: true });
  await amount.pressSequentially('12000000');
  await expect(sheet.getByTestId('switch-worth')).toContainText('Rp 10.000.000');
  await expect(page.getByRole('button', { name: 'Record switch' })).toBeDisabled();

  await amount.fill('5000000');
  await page.getByRole('button', { name: 'Record switch' }).click();
  await expect(sheet).toHaveCount(0);

  // The fund it left: half its value, and half the money put in, gone with it — no gain booked.
  await expect(page.getByTestId('asset-card')).toContainText('5.000.000');
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 4.000.000');
  const out = page.getByTestId('asset-history-row').filter({ hasText: 'Switched out' });
  await expect(out).toContainText(`into ${BOND}`);
  await expect(out).toContainText('−Rp 5.000.000');

  // The fund it went into: what arrived, and the cost that came with it.
  await openAsset(page, BOND);
  await expect(page.getByTestId('asset-card')).toContainText('7.000.000');
  await expect(page.getByTestId('asset-grid')).toContainText('Rp 6.000.000');
  const into = page.getByTestId('asset-history-row').filter({ hasText: 'Switched in' });
  await expect(into).toContainText(`from ${MONEY_MARKET}`);
  await expect(into).toContainText('+Rp 5.000.000');

  // 10.000.000 + 2.000.000 before; 5.000.000 + 7.000.000 after.
  await page.goto('/net-worth/assets');
  await expect(page.getByText('Rp 12.000.000').first()).toBeVisible();
});
