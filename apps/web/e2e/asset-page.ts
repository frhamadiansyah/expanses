import { expect, type Page } from '@playwright/test';
import { openNewAsset } from './add-asset';
import { openDrawers } from './drawers';

/** A priced thing through Add asset, one purchase line per [bought on, how much, total cost]. */
export async function addPriced(page: Page, pick: string, name: string, lines: [string, string, string][]) {
  await openNewAsset(page, pick);
  await page.getByLabel('Name', { exact: true }).fill(name);
  for (const [i, [on, much, cost]] of lines.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Add another purchase' }).click();
    await page.getByLabel('Bought on').nth(i).fill(on);
    await page.getByLabel('How much').nth(i).fill(much);
    await page.getByLabel(/^Total cost/).nth(i).fill(cost);
  }
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
}

/** A thing valued by an estimate through Add asset: what it cost, when, and what it is worth now. */
export async function addEstimated(page: Page, pick: string, name: string, on: string, cost: string, now: string) {
  await openNewAsset(page, pick);
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Bought on').fill(on);
  await page.getByLabel(/^What it cost/).fill(cost);
  await page.getByLabel(/^What it is worth now/).fill(now);
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
