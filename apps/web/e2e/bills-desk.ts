import { expect, type Page } from '@playwright/test';

/*
 * Bills on a wide screen (Mac Bills): the table's rows, the side peek a row opens, and the ticks that pay several. The
 * phone's Recurring list (⋯ menus, Select bills to pay, the Monthly/Repeating slider) is drawn in a phone's window.
 */

/** A bill's row in the All bills table, in whichever group it is. */
export const deskRow = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

/** A row still to pay: not in the Paid or Paused groups. */
export const toPayRow = (page: Page, name: string) =>
  page.locator('[data-testid="bill-row"]:not([data-testid="bills-paid"] *):not([data-testid="bills-paused"] *)').filter({ hasText: name });

/** Opens a bill's side peek from its row and waits for it to name the bill. */
export async function peekBill(page: Page, name: string) {
  await deskRow(page, name).first().click();
  const peek = page.getByTestId('bill-peek');
  await expect(peek.getByTestId('peek-title')).toContainText(name);
  return peek;
}

/** A peek's button (Pay, Skip, Pause, Resume, Edit, Open bill). */
export const peekButton = (page: Page, name: string | RegExp) => page.getByTestId('bill-peek').getByRole('button', { name, exact: typeof name === 'string' });

/** The desktop way to a bill's own page: a double-click on its row. */
export async function openBillPage(page: Page, name: string) {
  await deskRow(page, name).first().dblclick();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Ticks bills in the table and opens Pay several from the bar under it. */
export async function paySeveral(page: Page, names: readonly string[]) {
  for (const name of names) await page.getByRole('checkbox', { name: `Select ${name}` }).click();
  await expect(page.getByTestId('select-bar')).toContainText(`${names.length} selected`);
  await page.getByTestId('select-bar').getByRole('button', { name: `Pay ${names.length} ${names.length === 1 ? 'bill' : 'bills'}` }).click();
  return page.getByRole('dialog', { name: 'Pay several' });
}

/** The phone's Recurring page, in a phone's window, for its own parts (the Repeating slider, ⋯ menus, select mode). */
export async function phoneBills(page: Page, path = '/bills') {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(path);
}

/** Back to a desk-sized window. */
export async function deskWindow(page: Page) {
  await page.setViewportSize({ width: 1280, height: 720 });
}
