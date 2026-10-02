import { expect, type Locator, type Page } from '@playwright/test';

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
  await editGoal(page);
  await page.getByRole('button', { name: 'Work out the amount' }).click();
}

/**
 * A working whose save is still landing closes the form when it does. Anything read or clicked after "Use this
 * amount" waits for that first: the figures behind the form are visible while it is still closing.
 */
export async function workingSettled(page: Page) {
  await expect(page.getByRole('button', { name: 'Use this amount' })).toHaveCount(0);
}

/** A goal page's ⋯, then one of its lines: Edit, Mark paid, Mark not paid, Archive. `scope` is the page or its root. */
export async function goalMenu(scope: Page | Locator, item: string | RegExp) {
  const root = 'goto' in scope ? scope.getByTestId('goal-page') : scope;
  await root.getByRole('button', { name: 'More', exact: true }).first().click();
  await root.getByRole('menuitem', { name: item }).first().click();
}

/** Edit is behind the goal page's ⋯ now, beside Archive. */
export const editGoal = (scope: Page | Locator) => goalMenu(scope, /^Edit$/);

/**
 * What archiving says on a finished goal, read on Archive's line behind the ⋯ (and the menu put away again): the
 * note is there once the goal is done and only then.
 */
export async function expectArchiveNote(goal: Locator, shown: boolean) {
  await goal.getByRole('button', { name: 'More', exact: true }).first().click();
  const archive = goal.getByRole('menuitem', { name: /^Archive/ }).first();
  await expect(archive).toBeVisible();
  if (shown) await expect(archive).toContainText('Keeps the history, stops it claiming money.');
  else await expect(archive).not.toContainText('Keeps the history');
  await goal.page().keyboard.press('Escape');
  await expect(archive).toHaveCount(0);
}
