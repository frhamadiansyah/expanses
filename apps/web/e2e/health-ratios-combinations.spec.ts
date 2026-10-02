import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { addCap, budgetTab, openCapOf, openDrawer, openNewCap } from './budget';
import { editGoal, openGoalForm, openWorking } from './goals';
import { goalCard, goalRow } from './set-aside';
import { countsAs, expectNeed, markNeed, openCategory } from './categories';

/**
 * The health-ratio combinations (spec §15, Part 1 rows), one test a row, at desktop width.
 *
 * Every figure is typed a key at a time, as a person types it, and every assertion is a figure. The set-up is a
 * bank at Rp 20.000.000, Groceries Rp 2.000.000 and Restaurants Rp 1.000.000: Rp 17.000.000 is left and
 * Rp 3.000.000 went out, Rp 1.000.000 of it under Food and beverage.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function type(field: Locator, figure: string) {
  await field.click();
  await field.clear();
  await field.pressSequentially(figure, { delay: 30 });
}

async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '2000000', keyByKey: true });
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '1000000', keyByKey: true });
}

/** Row 2's marks: Food and beverage lifestyle, so Restaurants inherits it. */
async function markFoodLifestyle(page: Page) {
  await markNeed(page, 'Food and beverage', 'Lifestyle');
  await openCategory(page, 'Restaurants');
  await expectNeed(page, 'Restaurants', 'Lifestyle', 'Follows Food and beverage');
}

function emergencyCard(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Emergency fund', exact: true }) }).last();
}

function emergencyBase(page: Page) {
  return page.getByRole('radiogroup', { name: 'Emergency fund counts' });
}

/** Adds a goal from a template and leaves the browser on the goal's own page, where its working is read. */
async function addFromTemplate(page: Page, template: string, amount?: string) {
  await page.goto('/goals');
  await openGoalForm(page, template);
  if (amount) await type(page.getByLabel(/Cost in today's money/).first(), amount);
  await page.getByRole('button', { name: 'Add goal' }).last().click();
  // The save lands as a row on the list; the goal's own page is opened from it, where the working is opened next.
  await expect(goalRow(page, template)).toBeVisible();
  await goalCard(page, template);
}

/** Caps a category in a unit, the amount typed a key at a time, and waits for the sheet to close on it. */
async function cap(page: Page, option: string, every: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly', figure: string) {
  await addCap(page, { option, every, amount: figure, typed: true });
}

test('row 1 — nothing marked: essential and all read the same months', async ({ page }) => {
  await setUp(page);
  await page.goto('/net-worth/health');
  const card = emergencyCard(page);
  await expect(card).toContainText('5,7 months');
  // No goal, so the flat guide: 5,7 is inside it.
  await expect(card).toContainText('3–6 months');
  await expect(card).toContainText('On track');
  await emergencyBase(page).getByRole('radio', { name: 'All spending' }).click();
  await expect(emergencyBase(page).getByRole('radio', { name: 'All spending' })).toHaveAttribute('aria-checked', 'true');
  await expect(card).toContainText('5,7 months');
});

test('row 2 — Food and beverage lifestyle: essential counts groceries only', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.goto('/net-worth/health');
  // Rp 17 jt against Rp 2 jt of essential spending.
  await expect(emergencyCard(page)).toContainText('8,5 months');
});

test('row 3 — the same marks, counting all spending', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.goto('/net-worth/health');
  await expect(emergencyCard(page)).toContainText('8,5 months');
  await emergencyBase(page).getByRole('radio', { name: 'All spending' }).click();
  await expect(emergencyCard(page)).toContainText('5,7 months');
});

test('row 4 — Restaurants keeps its own essential mark under a lifestyle parent', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await countsAs(page, 'Restaurants').selectOption('essential');
  await expectNeed(page, 'Restaurants', 'Essential', 'Custom');
  await page.goto('/net-worth/health');
  await expect(emergencyCard(page)).toContainText('5,7 months');
});

test('row 5 — an emergency goal typed by hand sizes itself on essential spending', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await addFromTemplate(page, 'Emergency fund');
  // Six months of Rp 2 jt essential spending, under the figure on the goal's own page.
  await expect(page.getByTestId('goal-page')).toContainText('12.000.000');
});

test('row 6 — the same goal worked out counting all spending', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await addFromTemplate(page, 'Emergency fund');
  await expect(page.getByTestId('goal-page')).toContainText('12.000.000');

  await openWorking(page);
  await type(page.getByLabel('Months of outgoings'), '6');
  await expect(page.getByText('Custom figure · the guide is 3')).toBeVisible();
  await page.getByLabel('Counts', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // Six months of Rp 3 jt, lifestyle included.
  await expect(page.getByTestId('goal-page')).toContainText('18.000.000');
  await expect(page.getByTestId('goal-page')).not.toContainText('12.000.000');
});

test('row 7 — a weekly line overridden for one month keeps its unit, and next month is the week again', async ({ page }) => {
  await page.goto('/budget');
  await cap(page, '— Groceries', 'weekly', '500000');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');

  let sheet = await openCapOf(page, '— Groceries');
  await sheet.getByLabel('Just this month').check();
  // An override is a month's figure: no Every, and the amount is monthly.
  await expect(sheet.getByLabel('Every')).toHaveCount(0);
  await type(sheet.getByLabel('Cap', { exact: true }), '3000000');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('caps-total')).toContainText('3.000.000');

  // The month's own figure, and the week it was planned in still behind it.
  sheet = await openCapOf(page, '— Groceries');
  await expect(sheet.getByLabel('Just this month')).toBeChecked();
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('3.000.000');
  await sheet.getByLabel('Just this month').uncheck();
  await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue('500.000');
  await expect(sheet.getByLabel('Every')).toHaveValue('weekly');
  await sheet.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');
  sheet = await openCapOf(page, '— Groceries');
  await expect(sheet.getByLabel('Just this month')).not.toBeChecked();
});
test('row 8 — five units, and the total is the sum of the converted lines', async ({ page }) => {
  await page.goto('/budget');
  await cap(page, '— Groceries', 'daily', '50000');
  await cap(page, 'Utilities', 'weekly', '500000');
  await cap(page, 'Transportation', 'monthly', '900000');
  await cap(page, 'Education', 'quarterly', '15386000');
  await cap(page, 'Personal care', 'yearly', '2400000');
  // 1.520.833 + 2.166.667 + 900.000 + 5.128.667 + 200.000 — never the typed figures, never ×4 or ×30.
  await openDrawer(page, 'Household');
  await expect(page.getByTestId('line-Groceries')).toContainText('left of 1.520.833');
  await expect(page.getByTestId('line-Education')).toContainText('left of 5.128.667');
  await expect(page.getByTestId('line-Personal care')).toContainText('left of 200.000');
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('caps-total')).toContainText('9.916.167');

  // Each cap keeps what was typed and the unit it was typed in.
  for (const [option, figure, every] of [['— Groceries', '50.000', 'daily'], ['Education', '15.386.000', 'quarterly'], ['Personal care', '2.400.000', 'yearly']] as const) {
    const sheet = await openCapOf(page, option);
    await expect(sheet.getByLabel('Cap', { exact: true })).toHaveValue(figure);
    await expect(sheet.getByLabel('Every')).toHaveValue(every);
    await sheet.getByRole('button', { name: 'Close' }).click();
  }
});
test('row 9 — a workspace that reads in dollars types and converts in cents', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Studio');
  await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByLabel('Reads in').selectOption('USD');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page.getByRole('button', { name: 'Workspace', exact: true })).toContainText('Studio');

  await page.goto('/budget');
  const capSheet = await openNewCap(page);
  await capSheet.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await capSheet.getByLabel('Every').selectOption('weekly');
  await type(capSheet.getByLabel('Cap', { exact: true }), '10,00');
  // 1.000 cents × 52 ÷ 12 = 4.333,3 → 4.333 cents.
  await expect(capSheet).toContainText('43,33');
  await capSheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await budgetTab(page, 'Plan');
  await expect(page.getByTestId('caps-total')).toContainText('43,33');
  const again = await openCapOf(page, '— Groceries');
  await expect(again.getByLabel('Cap', { exact: true })).toHaveValue('10,00');
  await expect(again.getByLabel('Every')).toHaveValue('weekly');
});
test('row 10 — the month split into essential and lifestyle on the Budget page', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.goto('/budget');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Essential and lifestyle' }).click();
  await expect(page.getByTestId('spent-total')).toContainText('3.000.000');
  await expect(page.getByTestId('essential-spent')).toContainText('2.000.000');
  await expect(page.getByTestId('lifestyle-spent')).toContainText('1.000.000');
});
test('row 11 — the sections hold: a holiday never lists under compulsory', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');
  // The sections are the ranking: whatever order the goals were added in, each lists in its own.
  await page.goto('/goals');
  const compulsory = page.getByTestId('goals-compulsory');
  await expect(compulsory).toContainText('Emergency fund');
  await expect(compulsory).not.toContainText('Holiday');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');
  // The 15 jt is the goal's cost in today's money: the list and the card read it grown to its date, so it is read
  // where it was typed, in the goal's own form.
  await editGoal(await goalCard(page, 'Holiday'));
  await expect(page.getByLabel(/Cost in today's money/).first()).toHaveValue('15000000');
});

test('row 12 — a working reopens on the answers and base it was saved with', async ({ page }) => {
  await setUp(page);
  await addFromTemplate(page, 'Emergency fund');
  await openWorking(page);
  await page.getByLabel('Household').selectOption('children');
  await page.getByLabel('Income').selectOption('irregular');
  await page.getByLabel('Counts', { exact: true }).selectOption('all');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('24');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // 24 months of Rp 3 jt, all spending — the target under the figure on the goal's own page.
  await expect(page.getByTestId('goal-page')).toContainText('72.000.000');

  await page.goto('/accounts');
  await page.goto('/goals');
  await goalCard(page, 'Emergency fund');
  await openWorking(page);
  await expect(page.getByLabel('Household')).toHaveValue('children');
  await expect(page.getByLabel('Income')).toHaveValue('irregular');
  await expect(page.getByLabel('Counts', { exact: true })).toHaveValue('all');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('24');
  // The answers are the two rows above; the months row does not repeat them back.
  await expect(page.getByText(/with children, freelance/)).toHaveCount(0);
});

test('row 13 — the card grades against the household’s own months', async ({ page }) => {
  await setUp(page);
  await addFromTemplate(page, 'Emergency fund');
  await openWorking(page);
  await page.getByLabel('Household').selectOption('children');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('12');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // 12 months of Rp 3 jt, under the figure on the goal's own page.
  await expect(page.getByTestId('goal-page')).toContainText('36.000.000');

  await page.goto('/net-worth/health');
  const card = emergencyCard(page);
  await expect(card).toContainText('5,7 months');
  await expect(card).toContainText('12 months · this household');
  // Below 12 ÷ 1,2 = 10 months: act, where the flat guide of row 1 called the same 5,7 months on track.
  await expect(card).toContainText('Act now');
});
