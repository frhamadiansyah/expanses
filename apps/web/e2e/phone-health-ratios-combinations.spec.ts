import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { openGoalForm, openWorking } from './goals';
import { goalCard, goalRow } from './set-aside';

/**
 * The health-ratio combinations (spec §15, Part 1 rows), rows 2, 7, 9, 11 and 13 at phone width.
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
  await page.goto('/categories');
  await page.getByRole('button', { name: 'Mark Food and beverage lifestyle' }).click();
  await expect(page.getByTestId('need-Restaurants')).toHaveText('Lifestyle (from parent)');
}

function emergencyCard(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Emergency fund', exact: true }) }).last();
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

/** Caps a category in a unit, the amount typed a key at a time, and waits for the line to say it. */
async function cap(page: Page, option: string, line: string, every: string, figure: string, currency = 'IDR') {
  await page.getByLabel('Category', { exact: true }).selectOption({ label: option });
  await page.getByLabel('Every').selectOption(every);
  const words: Record<string, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };
  await type(page.getByLabel(`${words[every]} amount (${currency})`), figure);
  await page.getByRole('button', { name: 'Set budget' }).click();
  await expect(page.getByTestId(`line-${line}`).getByText(/^Cap/).first()).toBeVisible();
}

test('row 2 — Food and beverage lifestyle: essential counts groceries only', async ({ page }) => {
  await setUp(page);
  await markFoodLifestyle(page);
  await page.goto('/net-worth');
  // Rp 17 jt against Rp 2 jt of essential spending.
  await expect(emergencyCard(page)).toContainText('8,5 months');
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

test('row 9 — a workspace that reads in dollars types and converts in cents', async ({ page }) => {
  // A phone reaches the workspaces from Cashflow's ⋯.
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByTestId('filters-menu').getByTestId('workspace-row').click();
  await page.getByRole('dialog', { name: 'Workspaces' }).getByRole('button', { name: 'New workspace' }).click();
  const sheet = page.getByRole('dialog', { name: 'New workspace' });
  await sheet.getByLabel('Name', { exact: true }).fill('Studio');
  await sheet.getByLabel('Starts with').selectOption({ label: 'Copy from Personal' });
  await sheet.getByLabel('Reads in').selectOption('USD');
  await sheet.getByRole('button', { name: 'Create workspace' }).click();
  await expect(sheet).toHaveCount(0);

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

test('row 11 — the sections hold: a holiday never lists under compulsory', async ({ page }) => {
  await addFromTemplate(page, 'Holiday', '15000000');
  await addFromTemplate(page, 'Emergency fund');
  // The sections are the ranking: whatever order the goals were added in, each lists in its own.
  await page.goto('/goals');
  const compulsory = page.getByTestId('goals-compulsory');
  await expect(compulsory).toContainText('Emergency fund');
  await expect(compulsory).not.toContainText('Holiday');
  await expect(page.getByTestId('goals-additional')).toContainText('Holiday');
  // The 15 jt is the goal's target, which a row does not carry: it is read under the figure on the goal's page.
  await expect((await goalCard(page, 'Holiday')).getByText(/15\.000\.000/).first()).toBeVisible();
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

  await page.goto('/net-worth');
  const card = emergencyCard(page);
  await expect(card).toContainText('5,7 months');
  await expect(card).toContainText('12 months · your household');
  // Below 12 ÷ 1,2 = 10 months: act, where the flat guide of row 1 called the same 5,7 months on track.
  await expect(card).toContainText('Act now');
});
