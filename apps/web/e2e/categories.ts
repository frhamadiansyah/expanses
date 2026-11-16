import { expect, type Page } from '@playwright/test';

/** Open a category's own page from the Categories list, by the name its line carries. */
export async function openCategory(page: Page, name: string, kind: 'expense' | 'income' = 'expense') {
  await page.goto(kind === 'income' ? '/categories?kind=income' : '/categories');
  await page.getByTestId('category-tree').getByRole('link', { name, exact: true }).click();
  await expect(page.getByTestId('category-hero')).toContainText(name);
}

/** The Essential / Lifestyle / Debts & savings control on an open category page. */
export function countsAs(page: Page, name: string) {
  return page.getByRole('combobox', { name: `Spending for ${name}` });
}

export type NeedLabel = 'Essential' | 'Lifestyle' | 'Debts & savings';
const NEED_VALUES: Record<NeedLabel, string> = { Essential: 'essential', Lifestyle: 'lifestyle', 'Debts & savings': 'debts_savings' };

/** What an open category page says it counts as, and where that answer came from. */
/**
 * `source` null: no mark anywhere and no built-in one, so the row says nothing under Spending and only the control
 * reads Essential. A built-in category with nothing marked says 'Built in'.
 */
export async function expectNeed(page: Page, name: string, need: NeedLabel, source: string | null) {
  await expect(countsAs(page, name)).toHaveValue(NEED_VALUES[need]);
  if (source === null) await expect(page.getByTestId('need-source')).toHaveCount(0);
  else await expect(page.getByTestId('need-source')).toHaveText(source);
}

/** Give a category a mark of its own from its page. */
export async function markNeed(page: Page, name: string, need: NeedLabel) {
  await openCategory(page, name);
  await countsAs(page, name).selectOption(NEED_VALUES[need]);
  await expectNeed(page, name, need, 'Custom');
}
