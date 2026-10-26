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
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Split between categories' }).click();
  await expect(page.getByRole('dialog', { name: 'Split' })).toBeVisible();
}

/**
 * A split part's category, chosen as a person does: the part's Category row opens the searchable picker, whose
 * Workspace row (shown when more than one workspace is offered) changes the list to another workspace's categories.
 * `workspace` is that workspace's name, or "No workspace" for Not counted (which then needs no category).
 */
export async function pickPartCategory(page: Page, part: number, category: string, workspace?: string) {
  const split = page.getByRole('dialog', { name: 'Split' });
  await split.getByTestId('split-row').nth(part - 1).getByTestId('split-part-category').getByRole('button').click();
  const picker = page.getByRole('dialog', { name: 'Select category' });
  if (workspace) {
    await picker.getByRole('button', { name: /^Workspace/ }).click();
    await page.getByRole('dialog', { name: 'Workspace' }).getByRole('button', { name: new RegExp(`^${workspace}`) }).click();
    if (workspace === 'No workspace') return;
  }
  await picker.getByRole('button', { name: category, exact: true }).click();
  await expect(picker).toHaveCount(0);
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
