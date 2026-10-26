import type { Page } from '@playwright/test';

/** Chooses a bill's category in the picker sheet the Category row opens. Restaurants unless told otherwise. */
export async function pickBillCategory(page: Page, name = 'Restaurants') {
  await page.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Category', exact: true }).getByRole('button', { name, exact: true }).click();
}
