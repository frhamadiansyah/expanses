import { expect, type Page } from '@playwright/test';
import { addEducationGoal, stageLines, todayLines, typeInto } from './education-walk';

/**
 * The calculator combinations (spec §15, Part 2 rows). Every figure is typed a key at a time and every assertion is a
 * figure. Rows 1, 5 and 8 run again at phone width.
 */

/** "Rp 1.234.567" as 1234567. */
export const figure = (text: string) => Number(text.replace(/\D/g, ''));

/** Every stage line's figure in today's money, in page order. */
export async function todayFigures(page: Page): Promise<number[]> {
  const texts = await stageLines(page).allTextContents();
  return texts.map((text) => figure(/Rp\s?([\d.]+)\s*today/.exec(text)?.[1] ?? 'NaN'));
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

/** The goal card's "of Rp …": the plan's total, each stage inflated to its own date. */
export async function planTotal(page: Page): Promise<number> {
  const text = await page.locator('p').filter({ hasText: /^of Rp/ }).first().textContent();
  return figure(/of Rp\s?([\d.]+)/.exec(text ?? '')![1]!);
}

export async function neededAMonth(page: Page): Promise<number> {
  const text = await page.locator('section').filter({ has: page.getByText('Needed a month', { exact: true }) }).first().textContent();
  return figure(/Needed a month\s*Rp\s?([\d.]+)/.exec(text ?? '')![1]!);
}

/** One level, 2032 to 2038, 45 jt once at entry and 20 jt every year. */
export async function firstLevel(page: Page) {
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await typeInto(page, 'Starts in year', '2032');
  await typeInto(page, 'Until year', '2038');
  await typeInto(page, 'Enrollment today (IDR)', '45000000');
  await typeInto(page, 'Academic today (IDR)', '20000000');
}

/** Row 1: no birthday — calendar years, each due on 1 January, 65 jt then 20 jt five times. */
export async function row1(page: Page) {
  await addEducationGoal(page);
  await firstLevel(page);
  await expect(page.getByText('2032 to 2038 · due 1 January each year')).toBeVisible();
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(stageLines(page)).toHaveCount(6);
  expect(await todayFigures(page)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
  await expect(stageLines(page).first()).toContainText('Jan 2032');
}

/** Row 5: a stage marked paid keeps its mark when a level is added, and the target rises by exactly the new level. */
export async function row5(page: Page) {
  await row1(page);
  await page.getByRole('button', { name: 'Preschool · year 1: Saving for this' }).click();
  await expect(page.getByRole('button', { name: 'Preschool · year 1: Paid' })).toBeVisible();
  const before = sum(await todayFigures(page));
  expect(before).toBe(165_000_000);

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await typeInto(page, 'Starts in year', '2038');
  await typeInto(page, 'Until year', '2041');
  await typeInto(page, 'Academic today (IDR)', '30000000');
  await page.getByRole('button', { name: 'Use this amount' }).click();

  await expect(stageLines(page)).toHaveCount(9);
  await expect(page.getByRole('button', { name: 'Preschool · year 1: Paid' })).toBeVisible();
  // Three years of 30 jt: exactly 90 jt more in today's money.
  expect(sum(await todayFigures(page)) - before).toBe(90_000_000);
  await expect(todayLines(page, '30.000.000')).toHaveCount(3);
}

async function typeLife(page: Page, label: string, text: string) {
  const box = page.getByLabel(label, { exact: true });
  await box.click();
  await box.press('ControlOrMeta+a');
  await box.pressSequentially(text, { delay: 30 });
}

/** Row 8: life cover with resources above needs says so, with the surplus, and never a negative cover. */
export async function row8(page: Page) {
  await page.goto('/calculators/life-cover');
  await typeLife(page, 'Yearly amount your family needs (IDR)', '120000000');
  await typeLife(page, 'Debts to clear (IDR)', '300000000');
  await typeLife(page, 'Education still to fund (IDR)', '150000000');
  await typeLife(page, 'Final expenses (IDR)', '25000000');
  await typeLife(page, 'Liquid assets (IDR)', '2000000000');
  await typeLife(page, 'Cover already in force (IDR)', '500000000');
  const answer = page.getByTestId('answer-life-cover');
  await expect(answer).toContainText('No further cover needed');
  await expect(answer).toContainText('915.358.073');
  await expect(answer).not.toContainText('Cover to hold');
  await expect(answer).not.toContainText('-');
}
