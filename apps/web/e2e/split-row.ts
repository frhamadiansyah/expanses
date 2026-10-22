import { expect, type Page } from '@playwright/test';

/**
 * A split is chosen in the category picker — its first row — and once made it is read and reopened on the card's
 * Category row, which reads "Split" while it holds one. Either way this opens the Split sheet.
 */
export async function openSplit(page: Page) {
  const row = splitRow(page);
  if ((await row.count()) > 0) return row.click();
  // By its label: the list behind a desktop's form has a Category filter of its own.
  await page.getByLabel('Category', { exact: true }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: /^Split between categories/ }).click();
  await expect(page.getByRole('dialog', { name: 'Split' })).toBeVisible();
}

/** The card's Category row while it holds a split. */
export const splitRow = (page: Page) => page.getByRole('button', { name: 'Split', exact: true });

/** Online or offline, set on the Note's own glyph: each tap goes not set → Online → Offline. */
export async function setChannel(page: Page, to: 'Online' | 'Offline') {
  const glyph = page.getByRole('button', { name: /^Channel: / });
  for (let tap = 0; tap < 3; tap++) {
    if ((await glyph.getAttribute('aria-label')) === `Channel: ${to}`) return;
    await glyph.click();
  }
  await expect(glyph).toHaveAttribute('aria-label', `Channel: ${to}`);
}
