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

/** The Split sheet (not a part's sheet). */
export const splitSheet = (page: Page) => page.getByRole('dialog', { name: 'Split', exact: true });

/** One more part: the "Add a part" row at the foot of the Split sheet (the first press makes two). */
export async function addPart(page: Page) {
  await splitSheet(page).getByRole('button', { name: 'Add a part' }).click();
}

/** Opens part `part` (1-based) on its own sheet and returns it. */
export async function openPart(page: Page, part: number) {
  await splitSheet(page).getByTestId('split-row').nth(part - 1).click();
  const sheet = page.getByRole('dialog', { name: `Part ${part}` });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Shuts the open part sheet with its ✓. */
export async function donePart(page: Page) {
  await page.getByRole('dialog', { name: /^Part \d+$/ }).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: /^Part \d+$/ })).toHaveCount(0);
}

/** Part `part`'s amount typed on its sheet (grouped as it goes), then the sheet shut. */
export async function fillPart(page: Page, part: number, amount: string) {
  const sheet = await openPart(page, part);
  await sheet.getByLabel('Amount', { exact: true }).fill(amount);
  await donePart(page);
}

/** Part `part`'s Exclude from report switch: opened, set to `on` when given, its state asserted, and the sheet shut. */
export async function partExcluded(page: Page, part: number, on?: boolean) {
  const sheet = await openPart(page, part);
  const toggle = sheet.getByRole('checkbox', { name: 'Exclude from report' });
  if (on !== undefined) {
    if ((await toggle.isChecked()) !== on) await toggle.click();
    if (on) await expect(toggle).toBeChecked();
    else await expect(toggle).not.toBeChecked();
  }
  const state = await toggle.isChecked();
  await donePart(page);
  return state;
}

/** Part `part` taken away with its Remove part row. */
export async function removePart(page: Page, part: number) {
  const sheet = await openPart(page, part);
  await sheet.getByRole('button', { name: 'Remove part' }).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * A split part's category, chosen as a person does: the part's sheet has a Category row that opens the searchable picker,
 * whose Workspace row (shown when more than one workspace is offered) changes the list to another workspace's categories.
 * `workspace` is that workspace's name, or "No workspace" for Not counted (which then needs no category). The part's
 * sheet is shut again after.
 */
export async function pickPartCategory(page: Page, part: number, category: string, workspace?: string) {
  const sheet = await openPart(page, part);
  await sheet.getByTestId('split-part-category').getByRole('button').click();
  const picker = page.getByRole('dialog', { name: 'Select category' });
  if (workspace) {
    await picker.getByRole('button', { name: /^Workspace/ }).click();
    await page.getByRole('dialog', { name: 'Workspace' }).getByRole('button', { name: new RegExp(`^${workspace}`) }).click();
    if (workspace === 'No workspace') {
      await donePart(page);
      return;
    }
  }
  await picker.getByRole('button', { name: category, exact: true }).click();
  await expect(picker).toHaveCount(0);
  await donePart(page);
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
