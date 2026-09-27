import { expect, type Page } from '@playwright/test';

/** Open a category's own page from the Categories list, by the name its line carries. */
export async function openCategory(page: Page, name: string, kind: 'expense' | 'income' = 'expense') {
  await page.goto(kind === 'income' ? '/categories?kind=income' : '/categories');
  await page.getByTestId('category-tree').getByRole('link', { name, exact: true }).click();
  await expect(page.getByTestId('category-hero')).toContainText(name);
}

/** The Essential / Lifestyle control on an open category page. */
export function countsAs(page: Page, name: string) {
  return page.getByRole('radiogroup', { name: `What ${name} counts as` });
}

/** What an open category page says it counts as, and where that answer came from. */
export async function expectNeed(page: Page, name: string, need: 'Essential' | 'Lifestyle', source: string) {
  await expect(countsAs(page, name).getByRole('radio', { name: need })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('need-source')).toHaveText(source);
}

/** Give a category a mark of its own from its page. */
export async function markNeed(page: Page, name: string, need: 'Essential' | 'Lifestyle') {
  await openCategory(page, name);
  await countsAs(page, name).getByRole('radio', { name: need }).click();
  await expectNeed(page, name, need, 'Marked by you');
}
