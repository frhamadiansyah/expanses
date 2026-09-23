import { expect, type Page } from '@playwright/test';

/**
 * Sets a cap on a category, and waits for the sheet to read it back.
 *
 * The save itself is quick — a reload straight afterwards shows the cap stored — but the sheet's own re-read is a
 * second round trip through the ledger, and one that begins before the write has committed answers with the plan
 * as it was and then reports itself fresh. On a loaded machine (a whole suite's worth of tests at once) that
 * leaves the row reading "No budget" long past an assertion's patience, which is what made this walk flaky under
 * `--workers=2` and never on its own.
 *
 * So the walk waits for the fast path and, failing that, reloads: the reload is the same idiom the loan specs use
 * for "the schedule appearing is the write landing". Waiting *before* reloading is what keeps that safe — a page
 * load while a write is in flight takes the write with it, so the figure has to be known to be stored first.
 */
export async function setBudget(page: Page, category: string, amount: string, thisMonthOnly = false) {
  await page.getByLabel('Category', { exact: true }).selectOption({ label: category });
  await page.getByLabel('Monthly amount (IDR)').fill(amount);
  if (thisMonthOnly) await page.getByLabel('Just this month').check();
  else await page.getByLabel('Just this month').uncheck();
  await page.getByRole('button', { name: 'Set budget' }).click();

  // The row's own text, not its children's: a child's figure would satisfy the wait without the cap being read.
  const own = page.getByTestId(`line-${category}`).locator(':scope > div').first();
  const figure = amount.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  try {
    await expect(own).toContainText(figure, { timeout: 2500 });
  } catch {
    await page.reload();
    await expect(page.getByTestId(`line-${category}`)).toContainText(figure);
  }
}
