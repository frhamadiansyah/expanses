import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The Mac receipt (a wide screen's side peek on one transaction): Cashflow's own, or the one any other page opens over
 * itself. Both are the "Transaction details" panel.
 */
export const receiptPeek = (page: Page): Locator => page.getByRole('complementary', { name: 'Transaction details' });

/** A line of the peek by its label ("Paid with", "Total", "Rate"): the row, label and value. */
export const peekLine = (peek: Locator, label: string | RegExp): Locator =>
  peek.locator('div', { has: peek.page().locator('dt', { hasText: typeof label === 'string' ? new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) : label }) }).last();

/**
 * Opens a row's receipt on a wide screen: on Cashflow a click on the row; in an account's history (`from` given, the
 * list keeps its ⓘ) the ⓘ. Either way the peek, never the receipt page.
 */
export async function openRowPeek(page: Page, description: string, opts: { history?: boolean } = {}): Promise<Locator> {
  if (opts.history) await page.getByRole('link', { name: `Receipt for ${description}` }).first().click();
  else await page.getByTestId('transaction-row').filter({ hasText: description }).first().click();
  const peek = receiptPeek(page);
  await expect(peek.getByTestId('peek-title')).toBeVisible();
  return peek;
}
