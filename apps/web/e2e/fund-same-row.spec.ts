import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { fillDay, openNewAsset } from './add-asset';
import { openAsset } from './asset-page';
import { openAssets } from './drawers';

const HOLDING = /\/net-worth\/assets\/([^/]+)$/;
const ACROSS = /\/net-worth\/investments\/security\/[^/]+$/;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  void page.route('https://api.frankfurter.dev/**', (route) => void route.abort());
});

/**
 * A fund tracked by money, bought through Add asset and then valued as its app shows it, held at an institution typed
 * by name. Its page is left open, and its id is handed back. Invented figures and names throughout.
 */
async function fundAt(page: Page, o: { name: string; amount: string; value: string; place: string }): Promise<string> {
  await openNewAsset(page, 'Mutual fund');
  await page.getByLabel('Name', { exact: true }).fill(o.name);
  await fillDay(page, 'Bought', '2026-01-15');
  await page.getByLabel('Amount', { exact: true }).fill(o.amount);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await openAsset(page, o.name);
  await page.getByRole('button', { name: 'Value', exact: true }).click();
  await page.getByLabel('Value (IDR)').fill(o.value);
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(page.getByTestId('asset-card')).toContainText(o.value.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
  const held = page.getByLabel('Institution', { exact: true });
  await held.selectOption({ label: 'Another…' });
  const name = page.getByLabel('Place name');
  await name.fill(o.place);
  await name.blur();
  await expect(held).toHaveValue(o.place);
  return HOLDING.exec(new URL(page.url()).pathname)![1]!;
}

test('the same fund at two places is one row on Assets, opening the fund across its places', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Daybank', balance: '10000000' });
  const app = await fundAt(page, { name: 'Harbour Money Market', amount: '1000000', value: '1052000', place: 'Fund App' });
  const bank = await fundAt(page, { name: 'Harbour MM at bank', amount: '2000000', value: '1950000', place: 'Northbank' });

  // Not tied yet: each place is its own row.
  await openAssets(page);
  await expect(page.getByTestId('assets-fund-row')).toHaveCount(0);
  await expect(page.getByTestId('assets-kind-total-fund')).toContainText('3.002.000');

  // Tied in the second place's Settings, to the first.
  await page.goto(`/net-worth/assets/${bank}/settings`);
  await expect(page.getByText('Assets shows them as one row, with their total.')).toBeVisible();
  await page.getByLabel('Same fund as').selectOption({ label: 'Harbour Money Market' });
  await expect(page.getByLabel('Same fund as')).toHaveValue(app);

  // One row for the fund, at both places together; the drawer's total is the same two values, counted once.
  await openAssets(page);
  const row = page.getByTestId('assets-fund-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Harbour Money Market');
  await expect(row).toContainText('2 places');
  await expect(row).toContainText('3.002.000'); // 1.052.000 + 1.950.000
  await expect(page.getByRole('link', { name: /^Harbour MM at bank/ })).toHaveCount(0);
  await expect(page.getByTestId('assets-kind-total-fund')).toContainText('3.002.000');

  await row.click();
  await expect(page).toHaveURL(ACROSS);
  await expect(page.getByRole('heading', { name: 'Harbour Money Market', exact: true })).toBeVisible();
  const card = page.getByTestId('security-card');
  await expect(card).toContainText('Value now · all places');
  await expect(card).toContainText('3.002.000');
  await expect(card).toContainText('2 places');
  // Tracked by money, so what is in both places — never units added up.
  await expect(card.getByTestId('asset-grid')).toContainText('Money in');
  await expect(card.getByTestId('asset-grid')).toContainText('3.000.000');
  await expect(card).not.toContainText('units');
  // A buy or a sell is at one place, so this page has no round buttons.
  await expect(page.getByRole('button', { name: 'Buy', exact: true })).toHaveCount(0);

  const rows = page.getByTestId('held-at-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'Fund App' })).toContainText('1.052.000');
  await expect(rows.filter({ hasText: 'Northbank' })).toContainText('1.950.000');
  // Each place by its institution's name only: never the bank account in the app.
  await expect(rows.filter({ hasText: 'Daybank' })).toHaveCount(0);
  await expect(page.getByTestId('recent-row')).toHaveCount(2);

  await rows.filter({ hasText: 'Northbank' }).click();
  await expect(page).toHaveURL(new RegExp(`/net-worth/assets/${bank}$`));

  // Untied, the two places are their own rows again.
  await page.goto(`/net-worth/assets/${bank}/settings`);
  await page.getByLabel('Same fund as').selectOption({ label: 'No other place' });
  await expect(page.getByLabel('Same fund as')).toHaveValue('none');
  await openAssets(page);
  await expect(page.getByTestId('assets-fund-row')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /^Harbour MM at bank/ })).toHaveCount(1);
});
