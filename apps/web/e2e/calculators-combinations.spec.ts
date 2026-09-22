import { expect, type Page, test } from '@playwright/test';
import { figure, firstLevel, neededAMonth, planTotal, row1, row5, row8, todayFigures } from './calculator-walk';
import { addEducationGoal, stageLines, typeInto } from './education-walk';
import { localIsoDate } from './today';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addAccount(page: Page, name: string, type: string, balanceLabel: string, amount: string) {
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Type').selectOption(type);
  await typeInto(page, balanceLabel, amount);
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
}

const yearsAhead = (years: number, months = 0) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() + years);
  date.setMonth(date.getMonth() + months);
  return localIsoDate(date);
};

test('row 1 — no birthday: 65 jt, then 20 jt five times, each due on 1 January', async ({ page }) => {
  await row1(page);
});

test('row 2 — with a birthday: ages 6 to 12, the years on the birthday', async ({ page }) => {
  await addEducationGoal(page);
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByLabel('Birthday', { exact: true }).fill('2026-03-15');
  await page.getByRole('button', { name: 'Add a level' }).click();
  await typeInto(page, 'Starts at age', '6');
  await typeInto(page, 'Until age', '12');
  await typeInto(page, 'Enrollment today (IDR)', '45000000');
  await typeInto(page, 'Academic today (IDR)', '20000000');
  await expect(page.getByText('Ages 6 to 12 · 2032 to 2038')).toBeVisible();
  await page.getByRole('button', { name: 'Use this amount' }).click();

  await expect(stageLines(page)).toHaveCount(6);
  // Due on the sixth birthday, 15 March 2032 — not 1 January.
  await expect(stageLines(page).first()).toContainText('Mar 2032');
  await expect(stageLines(page).last()).toContainText('Mar 2037');
  expect(await todayFigures(page)).toEqual([65_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000, 20_000_000]);
});

test('row 3 — the once fee switched to every year moves the money into every year', async ({ page }) => {
  await addEducationGoal(page);
  await firstLevel(page);
  await page.getByLabel('Enrollment is paid', { exact: true }).selectOption('yearly');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(stageLines(page)).toHaveCount(6);
  expect(await todayFigures(page)).toEqual([65_000_000, 65_000_000, 65_000_000, 65_000_000, 65_000_000, 65_000_000]);
});

test('row 4 — a level’s return left to its band, then typed as 4,5, moves what a month needs', async ({ page }) => {
  await addEducationGoal(page);
  await firstLevel(page);
  // More than five years away: the long band, 8%.
  await expect(page.getByLabel('Assumed return (%)', { exact: true })).toHaveValue('8');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(stageLines(page)).toHaveCount(6);
  const banded = await neededAMonth(page);
  const total = await planTotal(page);

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await typeInto(page, 'Assumed return (%)', '4,5');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect.poll(() => neededAMonth(page)).not.toBe(banded);
  // Earning less, it needs more a month; what it costs does not move.
  expect(await neededAMonth(page)).toBeGreaterThan(banded);
  expect(await planTotal(page)).toBe(total);
  // And the typed return is what the working reopens on.
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await expect(page.getByLabel('Assumed return (%)', { exact: true })).toHaveValue('4.5');
});

test('row 5 — a paid stage keeps its mark when a level is added, and the target rises by exactly that level', async ({ page }) => {
  await row5(page);
});

test('row 6 — money set aside before a level is added: the target rises, what is held does not move', async ({ page }) => {
  await addAccount(page, 'BCA Tahapan', 'bank', 'Current balance', '50000000');
  await addEducationGoal(page);
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await typeInto(page, 'BCA Tahapan (IDR)', '10000000');
  await page.getByRole('button', { name: 'Save goal' }).click();
  const held = page.getByTestId('goal-link').filter({ hasText: 'BCA Tahapan' }).first();
  await expect(held).toContainText('10.000.000');

  await firstLevel(page);
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(stageLines(page)).toHaveCount(6);
  const before = await planTotal(page);

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByRole('button', { name: 'Add a level' }).click();
  await typeInto(page, 'Starts in year', '2038');
  await typeInto(page, 'Until year', '2041');
  await typeInto(page, 'Academic today (IDR)', '30000000');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  await expect(stageLines(page)).toHaveCount(9);

  expect(await planTotal(page)).toBeGreaterThan(before);
  await expect(held).toContainText('10.000.000');
  await expect(page.getByTestId('goal-link')).toHaveCount(1);
});

test('row 7 — retirement saved from the Retirement page: 3,5% growth, 10% return, and the page’s figure', async ({ page }) => {
  await page.goto('/calculators/retirement');
  await typeInto(page, 'Yearly spending in retirement (IDR)', '120000000');
  await typeInto(page, 'Your age now', '35');
  await typeInto(page, 'Age you retire', '55');
  const answer = page.getByTestId('answer-retirement');
  await expect(answer).toContainText('4.120.008.061');
  const youNeed = figure((await answer.locator('div > div').first().locator('p').nth(1).textContent()) ?? '');
  expect(youNeed).toBe(4_120_008_061);
  await page.getByRole('button', { name: 'Save Retirement fund as a goal' }).click();
  await expect(page.getByText('Saved Retirement fund as a goal.')).toBeVisible();

  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Retirement fund' })).toBeVisible();
  // The goal inflates its today's-money pot once, to the day you stop: the page's own figure.
  expect(await planTotal(page)).toBe(youNeed);
  await page.getByRole('button', { name: 'Edit' }).first().click();
  await expect(page.getByLabel('Cost growth a year (%)')).toHaveValue('3.5');
  await expect(page.getByLabel('Expected return a year (%)')).toHaveValue('10');
});

test('row 8 — life cover with more than enough: no further cover, and the surplus', async ({ page }) => {
  await row8(page);
});

test('row 9 — life cover opens on the loan and the education goal just added', async ({ page }) => {
  await addAccount(page, 'KPR Bintaro', 'loan', 'Amount owed now', '300000000');
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Education', exact: true }).click();
  await typeInto(page, "Cost in today's money (IDR)", '150000000');
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  await expect(page.getByRole('button', { name: 'Move Education down' })).toBeVisible();

  await page.goto('/calculators/life-cover');
  await expect(page.getByLabel('Debts to clear (IDR)', { exact: true })).toHaveValue('300000000');
  await expect(page.getByLabel('Education still to fund (IDR)', { exact: true })).toHaveValue('150000000');
});

test('row 10 — a holiday’s return follows its date until one is typed, then stays', async ({ page }) => {
  await page.goto('/goals');
  await page.getByRole('button', { name: 'Holiday', exact: true }).click();
  const expectedReturn = page.getByLabel('Expected return a year (%)');
  await expect(expectedReturn).toHaveValue('4');

  await page.getByLabel('Needed by').first().fill(yearsAhead(4));
  await expect(expectedReturn).toHaveValue('6');

  await expectedReturn.click();
  await expectedReturn.press('ControlOrMeta+a');
  await expectedReturn.pressSequentially('7', { delay: 30 });
  await page.getByLabel('Needed by').first().fill(yearsAhead(0, 9));
  await expect(expectedReturn).toHaveValue('7');
});
