import { expect, type Locator, type Page } from '@playwright/test';

/** The Budget page's two tabs. */
export async function budgetTab(page: Page, tab: 'Spending' | 'Plan') {
  await page.getByRole('radiogroup', { name: 'Budget view' }).getByRole('radio', { name: tab }).click();
}

/** ⋯ Month so far: what came in and went out, and what is left. */
export async function monthSoFar(page: Page) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Month so far' }).click();
}

/** The cap sheet, opened from ⋯ Add a budget: it asks for the category first. */
export async function openNewCap(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add a budget' }).click();
  return page.getByRole('dialog');
}

/** Opens a parent's drawer on the Spending tab, if it is not open already. */
export async function openDrawer(page: Page, parent: string) {
  const drawer = page.getByTestId(`drawer-${parent}`);
  if ((await drawer.getAttribute('aria-expanded')) !== 'true') await drawer.click();
}

export interface CapInput {
  /** The option as the picker lists it: a parent by name, a child as "— Groceries". */
  option: string;
  amount: string;
  every?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  thisMonthOnly?: boolean;
  /** Typed a key at a time, as a thumb types, rather than filled at once. */
  typed?: boolean;
}

/** Fills the cap sheet opened from ⋯ and saves it; waits for the sheet to close. */
export async function addCap(page: Page, input: CapInput) {
  const sheet = await openNewCap(page);
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: input.option });
  if (input.thisMonthOnly) await sheet.getByLabel('Just this month').check();
  else if (input.every) await sheet.getByLabel('Every').selectOption(input.every);
  const cap = sheet.getByLabel('Cap', { exact: true });
  if (input.typed) {
    await cap.click();
    await cap.clear();
    await cap.pressSequentially(input.amount, { delay: 30 });
  } else await cap.fill(input.amount);
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Sets a cap on a category from ⋯ Add a budget, and waits for the Plan tab's total to read it back.
 *
 * The sheet closes once the write is stored; the page's own re-read is a second round trip, and on a loaded machine
 * it can answer with the plan as it was. So the walk waits for the fast path and, failing that, reloads — safe,
 * because the write is known to be stored by then.
 */
export async function setBudget(page: Page, category: string, amount: string, thisMonthOnly = false) {
  await addCap(page, { option: category, amount, thisMonthOnly });
  const figure = amount.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const sheet = await openCapOf(page, category);
  try {
    await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue(figure, { timeout: 2500 });
  } catch {
    await page.keyboard.press('Escape');
    await page.reload();
    await expect((await openCapOf(page, category)).getByLabel('Cap', { exact: true })).toHaveValue(figure);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/** The cap sheet of a category already capped, opened from ⋯ with that category chosen. */
export async function openCapOf(page: Page, option: string): Promise<Locator> {
  const sheet = await openNewCap(page);
  await sheet.getByLabel('Category', { exact: true }).selectOption({ label: option });
  return sheet;
}
