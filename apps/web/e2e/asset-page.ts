import { expect, type Page } from '@playwright/test';
import { openNewAsset, fillDay } from './add-asset';
import { backFromSettings, openSettings, openValueSheet } from './accounts';
import { openDrawers } from './drawers';

/** A priced thing through Add asset, one purchase line per [bought on, how much, total cost]. */
export async function addPriced(page: Page, pick: string, name: string, lines: [string, string, string][]) {
  await openNewAsset(page, pick);
  await page.getByLabel('Name', { exact: true }).fill(name);
  for (const [i, [on, much, cost]] of lines.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Add another purchase' }).click();
    await fillDay(page, 'Bought', on, i);
    // A bond's rows read by par value; everything else by how much.
    const bond = /bonds$/.test(pick);
    await page.getByLabel(bond ? 'Par value' : 'How much', { exact: true }).nth(i).fill(much);
    await page.getByLabel(bond ? 'Purchase value' : 'Total cost', { exact: true }).nth(i).fill(cost);
  }
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
}

/** A thing valued by an estimate through Add asset: what it cost, when, and what it is worth now. */
export async function addEstimated(page: Page, pick: string, name: string, on: string, cost: string, now: string) {
  await openNewAsset(page, pick);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await fillDay(page, 'Acquired', on);
  await page.getByLabel('Original cost', { exact: true }).fill(cost);
  await page.getByLabel('Current value', { exact: true }).fill(now);
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
}

/** An asset's own page, from the Assets list. */
export async function openAsset(page: Page, name: string) {
  await page.goto('/net-worth/assets');
  await openDrawers(page);
  await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
  await expect(page.getByText('Value now')).toBeVisible();
}

/** Today's price, through the page's Price sheet. */
export async function typePrice(page: Page, typed: string) {
  await page.getByRole('button', { name: 'Price', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox').fill(typed);
  await page.getByRole('button', { name: 'Save price' }).click();
  await expect(page.getByRole('button', { name: 'Save price' })).toHaveCount(0);
}

/** Where the price came from and its day, behind the price figure's ⓘ ("Close today", "Your price", "World price"). */
export async function priceSaid(page: Page, label: string) {
  const about = page.getByTestId('asset-grid').getByRole('button', { name: `About ${label}` });
  if ((await about.getAttribute('aria-expanded')) !== 'true') await about.click();
  return page.getByTestId('price-said');
}

/**
 * An estimated asset's original cost and estimates changed from where they are kept: the cost in Settings, each
 * estimate from its ⋮ in the value history. Starts on the asset's page (a laptop bought for 22.000.000, worth 14.000.000).
 */
export async function changeCostAndEstimates(page: Page) {
  const rows = page.getByTestId('asset-history-row');
  const gain = page.getByTestId('asset-gain');
  await expect(gain).toHaveText('−Rp 8.000.000 · −36,4%');

  // The cost is a row of Settings, saved as it is left; the gain and the history's last row follow.
  await openSettings(page);
  const cost = page.getByRole('textbox', { name: 'Original cost' });
  await expect(cost).toHaveValue('22.000.000');
  await cost.fill('20000000');
  await cost.press('Tab');
  await backFromSettings(page);
  await expect(gain).toHaveText('−Rp 6.000.000 · −30,0%');
  await expect(rows.last()).toContainText('Original cost');
  await expect(rows.last()).toContainText('Rp 20.000.000');

  // A second estimate, then change it from its row.
  await openValueSheet(page);
  await page.getByLabel('Value (IDR)').fill('12000000');
  await page.getByRole('button', { name: 'Save value' }).click();
  await backFromSettings(page);
  await expect(gain).toHaveText('−Rp 8.000.000 · −40,0%');
  await expect(rows).toHaveCount(3);

  await rows.first().getByRole('button', { name: /^More for Estimated value/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit value' })).toBeVisible();
  await expect(page.getByLabel('Value (IDR)')).toHaveValue('12.000.000');
  await page.getByLabel('Value (IDR)').fill('16000000');
  await page.getByRole('button', { name: 'Save value' }).click();
  await expect(gain).toHaveText('−Rp 4.000.000 · −20,0%');
  await expect(rows).toHaveCount(3);

  // Deleting the latest brings the one before it back.
  await rows.first().getByRole('button', { name: /^More for Estimated value/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(gain).toHaveText('−Rp 6.000.000 · −30,0%');
  await expect(rows).toHaveCount(2);
  // The original cost row has no ⋮: it is changed in Settings.
  await expect(rows.last().getByRole('button')).toHaveCount(0);
}
