import { expect, type Page } from '@playwright/test';

/**
 * The + opens the template list, and a template opens the form it used to open by itself: the "Start from a
 * template" section that sat on the page is a sheet behind the action now.
 */
export async function openGoalForm(page: Page, template: string) {
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByRole('dialog', { name: 'Add a goal' }).getByRole('button', { name: template, exact: true }).click();
}

/**
 * The working behind a goal's amount. The pencil opens the goal's fields and the working together, and the row
 * inside it swaps the fields for the working — so this is one door, not two.
 */
export async function openWorking(page: Page) {
  await workingSettled(page);
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Work out the amount' }).click();
}

/**
 * A working whose save is still landing closes the form when it does. Anything read or clicked after "Use this
 * amount" waits for that first: the figures behind the form are visible while it is still closing.
 */
export async function workingSettled(page: Page) {
  await expect(page.getByRole('button', { name: 'Use this amount' })).toHaveCount(0);
}
