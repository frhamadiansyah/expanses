import { expect, type Locator, type Page, test } from '@playwright/test';
import { addTransaction } from './add-transaction';
import { openGoalForm } from './goals';
import { goalCard, goalRow } from './set-aside';

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
  await page.goto('/accounts');
  await page.getByLabel('Name', { exact: true }).fill('BCA Tahapan');
  await page.getByLabel('Type').selectOption('bank');
  await type(page.getByLabel('Current balance'), '20000000');
  await page.getByRole('button', { name: 'Add account' }).click();
  await expect(page.getByRole('link', { name: 'BCA Tahapan', exact: true })).toBeVisible();
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '2000000', keyByKey: true });
  await addTransaction(page, { description: 'Warung Steak', paidWith: 'BCA Tahapan', category: 'Restaurants', amount: '1000000', keyByKey: true });
}

/** Row 2's marks: Food and beverage lifestyle, so Restaurants inherits it. */
async function markFoodLifestyle(page: Page) {
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Mark Food and beverage lifestyle' }).click();
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Lifestyle (from parent)');
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
  // The save lands as a row on the list; the goal's own page is opened from it, and its move row proves it is there.
  await expect(goalRow(page, template)).toBeVisible();
  await expect((await goalCard(page, template)).getByRole('button', { name: `Move ${template} down` })).toBeVisible();
}

/** Caps a category in a unit, the amount typed a key at a time, and waits for the line to say it. */
async function cap(page: Page, option: string, line: string, every: string, figure: string, currency = 'IDR') {
  await page.getByLabel('Category', { exact: true }).selectOption({ label: option });
  await page.getByLabel('Every').selectOption(every);
  const words: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
  await type(page.getByLabel(`${words[every]} amount (${currency})`), figure);
  await page.getByRole('button', { name: 'Set budget' }).click();
  await expect(page.getByTestId(`line-${line}`).getByText(/^Cap/).first()).toBeVisible();
}

test('row 1 — nothing marked: essential and all read the same months', async ({ page }) => {
  await setUp(page);
  await page.goto('/net-worth');
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
  await page.goto('/net-worth');
  // Rp 17 jt against Rp 2 jt of essential spending.
  await expect(emergencyCard(page)).toContainText('8,5 months');
});

test('row 3 — the same marks, counting all spending', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.goto('/net-worth');
  await expect(emergencyCard(page)).toContainText('8,5 months');
  await emergencyBase(page).getByRole('radio', { name: 'All spending' }).click();
  await expect(emergencyCard(page)).toContainText('5,7 months');
});

test('row 4 — Restaurants keeps its own essential mark under a lifestyle parent', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.getByRole('button', { name: 'Mark Restaurants essential' }).click();
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Essential');
  await page.goto('/net-worth');
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

  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await type(page.getByLabel('Months of outgoings'), '6');
  await expect(page.getByText('Your own figure · the guide is 3')).toBeVisible();
  await page.getByLabel('Counts', { exact: true }).selectOption('all');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // Six months of Rp 3 jt, lifestyle included.
  await expect(page.getByTestId('goal-page')).toContainText('18.000.000');
  await expect(page.getByTestId('goal-page')).not.toContainText('12.000.000');
});

test('row 7 — a weekly line overridden for one month keeps its note, and next month is the week again', async ({ page }) => {
  await page.goto('/budget');
  await cap(page, '— Groceries', 'Groceries', 'weekly', '500000');
  const line = page.getByTestId('line-Groceries');
  await expect(line).toContainText('2.166.667');

  await page.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await page.getByLabel('Just this month').check();
  // An override is a month's figure: no Every, and the amount is monthly.
  await expect(page.getByLabel('Every')).toHaveCount(0);
  await type(page.getByLabel('Monthly amount (IDR)'), '3000000');
  await page.getByRole('button', { name: 'Set budget' }).click();
  await expect(line).toContainText('just this month');
  await expect(line).toContainText('3.000.000');
  await expect(line).toContainText('500.000 a week');
  await expect(page.getByTestId('caps-total')).toContainText('3.000.000');

  await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByTestId('caps-total')).toContainText('2.166.667');
  await expect(line).toContainText('2.166.667');
  await expect(line).not.toContainText('just this month');
});

test('row 8 — five units, and the total is the sum of the converted lines', async ({ page }) => {
  await page.goto('/budget');
  await cap(page, '— Groceries', 'Groceries', 'daily', '50000');
  await cap(page, 'Utilities', 'Utilities', 'weekly', '500000');
  await cap(page, 'Transportation', 'Transportation', 'monthly', '900000');
  await cap(page, 'Education', 'Education', 'quarterly', '15386000');
  await cap(page, 'Personal care', 'Personal care', 'yearly', '2400000');
  // 1.520.833 + 2.166.667 + 900.000 + 5.128.667 + 200.000 — never the typed figures, never ×4 or ×30.
  await expect(page.getByTestId('caps-total')).toContainText('9.916.167');
  await expect(page.getByTestId('line-Groceries')).toContainText('1.520.833');
  await expect(page.getByTestId('line-Groceries')).toContainText('50.000 a day');
  await expect(page.getByTestId('line-Education').getByText(/^Cap/).first()).toContainText('5.128.667');
  await expect(page.getByTestId('line-Education').getByText(/^Cap/).first()).toContainText('15.386.000 a quarter');
  await expect(page.getByTestId('line-Personal care').getByText(/^Cap/).first()).toContainText('2.400.000 a year');
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
  await page.getByLabel('Category', { exact: true }).selectOption({ label: '— Groceries' });
  await page.getByLabel('Every').selectOption('weekly');
  const amount = page.getByLabel('Weekly amount (USD)');
  await type(amount, '10,00');
  // 1.000 cents × 52 ÷ 12 = 4.333,3 → 4.333 cents.
  await expect(page.locator('body')).toContainText('43,33');
  await page.getByRole('button', { name: 'Set budget' }).click();
  await expect(page.getByTestId('caps-total')).toContainText('43,33');
  await expect(page.getByTestId('line-Groceries')).toContainText('10,00 a week');
});

test('row 10 — the month split into essential and lifestyle on the Budget page', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.goto('/budget');
  await expect(page.getByTestId('spent-total')).toContainText('3.000.000');
  await expect(page.getByTestId('essential-spent')).toContainText('2.000.000');
  await expect(page.getByTestId('lifestyle-spent')).toContainText('1.000.000');
});

test('row 11 — neither move crosses the sections', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');
  await (await goalCard(page, 'Holiday')).getByRole('button', { name: 'Move Holiday up' }).click();
  await (await goalCard(page, 'Emergency fund')).getByRole('button', { name: 'Move Emergency fund down' }).click();
  // The list is where the order is read, so a move from a goal's own page lands back on it.
  await page.goto('/goals');
  const compulsory = page.getByTestId('goals-compulsory');
  await expect(compulsory).toContainText('Emergency fund');
  await expect(compulsory).not.toContainText('Holiday');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');
  // The 15 jt is the goal's target, which a row does not carry: it is read under the figure on the goal's page.
  await expect((await goalCard(page, 'Holiday')).getByText(/15\.000\.000/).first()).toBeVisible();
});

test('row 12 — a working reopens on the answers and base it was saved with', async ({ page }) => {
  await setUp(page);
  await addFromTemplate(page, 'Emergency fund');
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByLabel('Household').selectOption('children');
  await page.getByLabel('Income').selectOption('irregular');
  await page.getByLabel('Counts', { exact: true }).selectOption('all');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('24');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // 24 months of Rp 3 jt, all spending — the target under the figure on the goal's own page.
  await expect(page.getByTestId('goal-page')).toContainText('72.000.000');

  await page.goto('/accounts');
  await page.goto('/goals');
  await (await goalCard(page, 'Emergency fund')).getByRole('button', { name: 'Work out the amount' }).click();
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
  await page.getByRole('button', { name: 'Work out the amount' }).click();
  await page.getByLabel('Household').selectOption('children');
  await expect(page.getByLabel('Months of outgoings')).toHaveValue('12');
  await page.getByRole('button', { name: 'Use this amount' }).click();
  // 12 months of Rp 3 jt, under the figure on the goal's own page.
  await expect(page.getByTestId('goal-page')).toContainText('36.000.000');

  await page.goto('/net-worth');
  const card = emergencyCard(page);
  await expect(card).toContainText('5,7 months');
  await expect(card).toContainText('12 months · your household');
  // Below 12 ÷ 1,2 = 10 months: act, where the flat guide of row 1 called the same 5,7 months on track.
  await expect(card).toContainText('Act now');
});
