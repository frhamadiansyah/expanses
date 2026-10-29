import { expect, type Locator, type Page } from '@playwright/test';

/**
 * The + opens the New goal page, and the kind is a row on it: choosing one re-applies that kind's template, so the
 * page is left on the same fields the template list used to open.
 */
export async function openGoalForm(page: Page, template: string) {
  await page.getByRole('button', { name: 'Add goal' }).first().click();
  await expect(page.getByTestId('goal-form')).toBeVisible();
  await page.getByLabel('Kind', { exact: true }).selectOption({ label: template });
}

/** The Assumptions row on a goal form, opened: the small sheet with Cost growth a year and Expected return a year. */
export async function openAssumptions(page: Page) {
  await page.getByRole('button', { name: /^Assumptions/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Assumptions' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Puts the Assumptions sheet away again, so the fields behind it can be reached. */
export async function closeAssumptions(page: Page) {
  await page.getByRole('dialog', { name: 'Assumptions' }).getByRole('button', { name: 'Close' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Assumptions' })).toHaveCount(0);
}

/** One figure from the Assumptions sheet ('Cost growth a year' or 'Expected return a year'): opened, read, put away. */
export async function assumption(page: Page, label: 'Cost growth a year' | 'Expected return a year') {
  const sheet = await openAssumptions(page);
  const value = await sheet.getByLabel(label, { exact: true }).inputValue();
  await closeAssumptions(page);
  return value;
}

/** Types a figure into the Assumptions sheet, one key at a time when asked, and puts the sheet away. */
export async function setAssumption(page: Page, label: 'Cost growth a year' | 'Expected return a year', value: string, keys = false) {
  const sheet = await openAssumptions(page);
  const field = sheet.getByLabel(label, { exact: true });
  if (keys) {
    await field.click();
    await field.press('ControlOrMeta+a');
    await field.pressSequentially(value, { delay: 30 });
  } else await field.fill(value);
  await closeAssumptions(page);
}

/**
 * A goal form's currency, tapped, and a currency chosen from the list that opens: the grey code sits on the cost row
 * (or, for a goal counted in months, a Currency row sits beside Assumptions).
 */
export async function pickGoalCurrency(page: Page, code: string) {
  await page.getByRole('button', { name: /^Currency:? [A-Z]{3}$/ }).first().click();
  await page.getByRole('dialog', { name: 'Currency' }).getByRole('button', { name: new RegExp(`^${code} `) }).first().click();
}

/** Adds a second (or later) payment through the sheet the Add a payment row opens, and saves it. */
export async function addPayment(page: Page, payment: { what: string; cost: string; dueOn?: string }) {
  await page.getByRole('button', { name: 'Add a payment' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a payment' });
  await sheet.getByLabel('What', { exact: true }).fill(payment.what);
  await sheet.getByLabel(/Cost today/).fill(payment.cost);
  if (payment.dueOn) await sheet.getByLabel('Due by').fill(payment.dueOn);
  await sheet.getByRole('button', { name: 'Save payment' }).click();
  await expect(sheet).toHaveCount(0);
}

/**
 * The working behind a goal's amount. The pencil opens the goal's fields and the working together, and the row
 * inside it swaps the fields for the working — so this is one door, not two.
 */
export async function openWorking(page: Page) {
  await workingSettled(page);
  await editGoal(page);
  await page.getByRole('button', { name: 'Calculator' }).click();
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
