import { expect, type Page } from '@playwright/test';

/** Chooses a bill's category in the picker sheet the Category row opens. Restaurants unless told otherwise. */
export async function pickBillCategory(page: Page, name = 'Restaurants') {
  await page.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Category', exact: true }).getByRole('button', { name, exact: true }).click();
}

/** Chooses a bill's paying account in the sheet the Paid from row opens: the row named `name`, whatever caption it carries. */
export async function pickBillPaidFrom(page: Page, name: string) {
  await page.getByRole('button', { name: /^Paid from/ }).click();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await page.getByRole('dialog', { name: 'Paid from', exact: true }).getByRole('button', { name: new RegExp(`^${escaped}(,|$)`) }).click();
}

/** A window wide enough for the Mac pages (Mac Bills), where the phone's Recurring slider is not drawn. */
const wide = (page: Page) => (page.viewportSize()?.width ?? 0) >= 768;

/**
 * The repeating bills: on a phone Recurring's hero slides to its Repeating page (the second dot), where the repeating
 * bills and the set-aside figure are; on a wide screen (Mac Bills) the title bar's Yearly bills opens their list.
 */
export async function showRepeating(page: Page) {
  if (wide(page)) {
    await page.getByRole('button', { name: 'Yearly bills', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Repeating bills' })).toBeVisible();
    return;
  }
  await page.getByRole('group', { name: 'Page' }).getByRole('button', { name: 'Repeating' }).click();
  await expect(page.getByTestId('repeating-summary')).toBeVisible();
}

/** Back to the month's bills: the phone's hero slides to Monthly (the first dot); a wide screen's Bills is one page. */
export async function showMonthly(page: Page) {
  if (wide(page)) {
    await expect(page.getByTestId('bills-page')).toBeVisible();
    return;
  }
  await page.getByRole('group', { name: 'Page' }).getByRole('button', { name: 'Monthly' }).click();
  await expect(page.getByTestId('bills-summary').or(page.getByText('No monthly bills yet'))).toBeVisible();
}
