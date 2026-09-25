import { expect, test } from '@playwright/test';
import { openDrawers } from './drawers';

/**
 * The same three ways in, by thumb. A phone gets one screen at a time, so what has to be proved here is that a
 * step back undoes exactly one step, and that the screen says where a thing it does not handle belongs instead.
 */

test('two levels by thumb: a family, the thing, and the way back', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  await expect(page.getByRole('heading', { name: 'New asset' })).toBeVisible();
  await page.getByRole('button', { name: 'Investments' }).click();
  await expect(page.getByRole('button', { name: 'Mutual fund (reksadana)' })).toBeVisible();
  // The circle at the top left is the destination, named — "Assets" — not the word "Back": this screen was opened
  // from that list, and one tap undoes one step of this screen before it goes anywhere.
  await page.getByRole('button', { name: 'Assets' }).click();
  await expect(page.getByRole('button', { name: /^Movable property/ })).toBeVisible();

  // Money is an account, not an asset, and the screen says where to go instead — as a link, so a long press
  // can open it in its own tab and the router never sees a navigation it did not make.
  await page.getByRole('link', { name: 'Add an account instead' }).click();
  await expect(page.getByRole('heading', { name: 'New account' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Time deposit' })).toBeVisible();

  await page.getByRole('link', { name: 'Add a debt instead' }).click();
  await expect(page.getByRole('heading', { name: 'New debt' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Online loan or paylater' })).toBeVisible();
});

test('a phone finds a thing by typing, without knowing its family', async ({ page }) => {
  await page.goto('/net-worth/assets/new');
  // Searching is a corner on a phone, and the field takes the name's place in the bar rather than the list's first row.
  await page.getByRole('button', { name: 'Search' }).click();
  await page.getByPlaceholder('Search everything you can own').fill('patent');
  await page.getByRole('button', { name: 'Patent' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Paten alat panen');
  await page.getByLabel('Bought on').fill('2024-08-08');
  await page.getByLabel('What it cost (IDR)').fill('15000000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The list folds its rows into a drawer per kind, so the row is one tap away.
  await openDrawers(page);
  await expect(page.getByText('0601 · Harta Lainnya')).toBeVisible();
});
