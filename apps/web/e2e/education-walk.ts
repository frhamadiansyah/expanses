import { expect, type Locator, type Page } from '@playwright/test';

/** Types a figure a key at a time into the last box with this label — the newest level's, when there are two. */
export async function typeInto(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true }).last();
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(text, { delay: 30 });
}

/** Adds an education goal from its template, with a placeholder cost the calculator replaces. */
export async function addEducationGoal(page: Page) {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Education', exact: true }).click();
  await typeInto(page, "Cost in today's money (IDR)", '1000000');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('button', { name: 'Move Education down' })).toBeVisible();
}

/** The goal's stage lines: each is named "<level> · year <n>: <state>". */
export function stageLines(page: Page): Locator {
  return page.getByRole('button', { name: / · year \d+: / });
}

/** How many stage lines say this figure in today's money. */
export function todayLines(page: Page, figure: string): Locator {
  return stageLines(page).filter({ hasText: new RegExp(`${figure.replace(/\./g, '\\.')} today`) });
}

/**
 * Two levels, a once fee and a yearly one, and a level added later raises the target — each stage in today's money:
 * 45 jt once and six years of 20 jt (Rp 165.000.000), then three years of 30 jt more (Rp 255.000.000).
 */
export async function twoLevelsWalk(page: Page) {
  await addEducationGoal(page);
  await page.getByRole('button', { name: 'Work out the amount' }).click();

  await page.getByRole('button', { name: 'Add a level' }).click();
  await typeInto(page, 'Starts in year', '2032');
  await typeInto(page, 'Until year', '2038');
  await typeInto(page, 'Enrollment today (IDR)', '45000000');
  await typeInto(page, 'Academic today (IDR)', '20000000');
  await expect(page.getByText('2032 to 2038 · due 1 January each year')).toBeVisible();
  await page.getByRole('button', { name: 'Use this amount' }).click();

  await expect(stageLines(page)).toHaveCount(6);
  await expect(todayLines(page, '65.000.000')).toHaveCount(1);
  await expect(todayLines(page, '20.000.000')).toHaveCount(5);

  // The saved levels come back: the second working starts from the first, not from nothing.
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await expect(page.getByLabel('Starts in year', { exact: true })).toHaveValue('2032');
  await expect(page.getByLabel('Enrollment today (IDR)', { exact: true })).toHaveValue('45000000');
  await page.getByRole('button', { name: 'Add a level' }).click();
  await typeInto(page, 'Starts in year', '2038');
  await typeInto(page, 'Until year', '2041');
  await typeInto(page, 'Academic today (IDR)', '30000000');
  await page.getByRole('button', { name: 'Use this amount' }).click();

  await expect(stageLines(page)).toHaveCount(9);
  await expect(todayLines(page, '65.000.000')).toHaveCount(1);
  await expect(todayLines(page, '20.000.000')).toHaveCount(5);
  await expect(todayLines(page, '30.000.000')).toHaveCount(3);
}
