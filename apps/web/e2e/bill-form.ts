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

/** Slides Recurring's hero to its Repeating page (the second dot), where the repeating bills and the set-aside figure are. */
export async function showRepeating(page: Page) {
  await page.getByRole('group', { name: 'Page' }).getByRole('button', { name: 'Repeating' }).click();
  await expect(page.getByTestId('repeating-summary')).toBeVisible();
}

/** Slides Recurring's hero back to its Monthly page (the first dot). */
export async function showMonthly(page: Page) {
  await page.getByRole('group', { name: 'Page' }).getByRole('button', { name: 'Monthly' }).click();
  // The box is there in every state now, "No monthly bills yet" inside it (owner, 22 Nov 2026).
  await expect(page.getByTestId('bills-summary')).toBeVisible();
}
