import { expect, type Page } from '@playwright/test';

/**
 * The Assets page's `+` opens the add-asset page now, not a form unrolled over the list: the picker asks what the
 * thing is, and only then draws the fields that answer needs — the same shape the Accounts page has always had.
 *
 * A walk says what it wants in the picker's own words ("Gold bullion", "Other receivables"). Typing narrows the
 * list to the things themselves, so choosing takes one click; on a phone the form then takes the list's place.
 */
export async function openNewAsset(page: Page, pick: string) {
  await page.goto('/net-worth/assets');
  await page.getByRole('link', { name: 'Add asset' }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/new$/);
  // The picker matches word prefixes and drops punctuation when it splits a label into words, so a pick that
  // carries brackets is typed without them — the click still names the entry's own label, punctuation and all.
  await page.getByPlaceholder('Search everything you can own').pressSequentially(pick.replace(/[^\p{L}\p{N}\s-]+/gu, ' ').replace(/\s+/g, ' ').trim());
  await page.getByRole('button', { name: pick }).click();
}
