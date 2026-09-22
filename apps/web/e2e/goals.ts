import { type Page } from '@playwright/test';

/**
 * The + opens the template list, and a template opens the form it used to open by itself: the "Start from a
 * template" section that sat on the page is a sheet behind the action now.
 */
export async function openGoalForm(page: Page, template: string) {
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await page.getByRole('dialog', { name: 'Add a goal' }).getByRole('button', { name: template, exact: true }).click();
}
