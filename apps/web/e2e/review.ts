import type { Page } from '@playwright/test';

/**
 * A capture's category chosen on Mac Review (a wide screen): the row's Category cell opens the phone's own Select
 * category sheet, named for the capture, and the category is picked in it.
 */
export async function pickDraftCategory(page: Page, description: string, category: string) {
  await page.getByTestId('draft-row').filter({ hasText: description }).getByRole('button', { name: `Category for ${description}` }).click();
  await page.getByRole('dialog', { name: `Category for ${description}` }).getByRole('button', { name: category, exact: true }).click();
}
