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

/** A category as the old picker named it ("— Groceries") or as the screens do ("Groceries"). */
const plain = (option: string) => option.replace(/^— /, '');

/** Opens Edit budgets from the Budget page's ✎ corner. */
export async function openEditBudgets(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Edit budgets', exact: true }).first().click();
  const screen = page.getByTestId('edit-budgets');
  await expect(screen).toBeVisible();
  return screen;
}

/** A category's field on Edit budgets: a root with sub-categories is "All <root>" there. */
export async function capField(screen: Locator, option: string): Promise<{ field: Locator; label: string }> {
  const name = plain(option);
  // The rows arrive once the month's sheet and its budgets are read; asked before then, every label is missing.
  await expect(screen.locator('[data-testid^="edit-row-"]').first()).toBeVisible();
  const all = screen.getByLabel(`All ${name}`, { exact: true });
  const label = (await all.count()) > 0 ? `All ${name}` : name;
  return { field: screen.getByLabel(label, { exact: true }), label };
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

/**
 * Sets one cap and saves it: on Edit budgets, or — for one month alone — on the category's own sheet, which only a cap
 * that already exists offers. Back on the Budget page when it returns.
 */
export async function addCap(page: Page, input: CapInput) {
  if (input.thisMonthOnly) {
    const sheet = await openCapOf(page, input.option);
    await sheet.getByLabel('Just this month').check();
    await sheet.getByLabel('Cap', { exact: true }).fill(input.amount);
    await sheet.getByRole('button', { name: 'Save budget' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    return;
  }
  const screen = await openEditBudgets(page);
  const { field, label } = await capField(screen, input.option);
  await screen.getByLabel(`${label} every`).selectOption(input.every ?? 'monthly');
  if (input.typed) {
    await field.click();
    await field.clear();
    await field.pressSequentially(input.amount, { delay: 30 });
  } else await field.fill(input.amount);
  await page.getByRole('button', { name: 'Save budgets' }).click();
  await expect(page.getByTestId('budget-page')).toBeVisible();
}

/**
 * Sets a cap on a category from Edit budgets, and waits for its sheet to read it back.
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

/**
 * The cap sheet of a category, opened from its own row on the Spending tab: its capped row (a folded drawer opened
 * first), or its row under No budget yet.
 */
export async function openCapOf(page: Page, option: string): Promise<Locator> {
  const name = plain(option);
  await page.keyboard.press('Escape');
  await budgetTab(page, 'Spending');
  const capped = page.getByTestId(`line-${name}`).first();
  const uncapped = page.getByTestId(`uncapped-${name}`);
  // isVisible does not wait: the rows (or a folded drawer holding them) must be on the page before it is asked.
  await expect(capped.or(uncapped).or(page.locator('[data-testid^="drawer-"]')).first()).toBeVisible();
  if (!(await capped.isVisible()) && !(await uncapped.isVisible())) {
    for (const drawer of await page.locator('[data-testid^="drawer-"][aria-expanded="false"]').all()) await drawer.click();
  }
  await ((await capped.isVisible()) ? capped : uncapped).click();
  const sheet = page.getByRole('dialog', { name });
  await expect(sheet).toBeVisible();
  return sheet;
}
