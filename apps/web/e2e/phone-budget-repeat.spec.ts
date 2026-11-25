import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { addCap, openCapOf, openDrawer } from './budget';

/*
 * Budget C (owner, 25 Nov 2026): a budget typed the way it repeats, watched by the month. The son's pocket money
 * Rp 100.000 a week, cafe Rp 50.000 a day, the electricity token Rp 1.000.000 every 3 weeks from 3 Nov, restaurants
 * Rp 2.000.000 a month. November 2026 holds 30 days, 5 Mondays and two token dates (3, 24 Nov); December 31 days,
 * 4 Mondays and one (15 Dec). Invented bank and figures. The browser's clock stands on Wed 25 Nov 2026.
 */

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
};

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.clock.setSystemTime(new Date('2026-11-25T10:00:00'));
});

async function spend(page: Page, what: string, category: string, amount: string, date: string) {
  await addTransaction(page, { description: what, paidWith: 'Bank Contoh', category, amount, date });
}

const line = (page: Page, name: string) => page.getByTestId(`line-${name}`);

test('a budget by the week, the day and every 3 weeks reads its month, and says how it repeats under its name', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '20000000', opened: '2026-10-01' });
  await page.goto('/transactions');
  await spend(page, 'Uang saku', 'Pocket money', '400000', '2026-11-20');
  await spend(page, 'Kopi Kenangan', 'Cafe & dessert', '1210000', '2026-11-22');
  await spend(page, 'Warung Padang', 'Restaurants', '850000', '2026-11-18');

  await page.goto('/budget');
  // On Edit budgets: a week, a day and every 3 weeks by the Every list.
  await addCap(page, { option: 'Pocket money', amount: '100000', every: 'weekly' });
  await addCap(page, { option: 'Cafe & dessert', amount: '50000', every: 'daily' });
  await addCap(page, { option: 'Restaurants', amount: '2000000' });
  await addCap(page, { option: 'Electricity', amount: '1000000', every: 'weeks-3' });
  for (const parent of ['Education', 'Food and beverage', 'Utilities']) await openDrawer(page, parent);
  // Every 3 weeks set there is counted from the day it was saved, 25 Nov, forwards and back: 4 and 25 Nov.
  await expect(line(page, 'Electricity')).toContainText('left of 2.000.000');

  // On the category's own sheet, its start moved: from 10 Nov, November holds one date; from 3 Nov, two (3 and 24 Nov).
  const sheet = await openCapOf(page, 'Electricity');
  await expect(sheet.getByLabel('Every', { exact: true })).toHaveValue('weeks-3');
  await expect(sheet.getByLabel('Starts on')).toHaveValue('2026-11-25');
  await sheet.getByLabel('Starts on').fill('2026-11-10');
  await expect(sheet.getByText('November', { exact: true })).toBeVisible();
  await expect(sheet).toContainText(/Rp\s?1\.000\.000/);
  await sheet.getByLabel('Starts on').fill('2026-11-03');
  await expect(sheet).toContainText(/Rp\s?2\.000\.000/);
  await shot(page, 'edit-sheet-every-3-weeks');
  await sheet.getByRole('button', { name: 'Save budget' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(line(page, 'Pocket money')).toContainText('left of 500.000');
  await expect(line(page, 'Pocket money').getByTestId('budget-repeat')).toHaveText('100.000 a week');
  await expect(line(page, 'Cafe & dessert')).toContainText('left of 1.500.000');
  await expect(line(page, 'Cafe & dessert').getByTestId('budget-repeat')).toHaveText('50.000 a day');
  await expect(line(page, 'Electricity')).toContainText('left of 2.000.000');
  await expect(line(page, 'Electricity').getByTestId('budget-repeat')).toHaveText('1.000.000 every 3 weeks');
  // A monthly budget is exactly as it was: no second line.
  await expect(line(page, 'Restaurants')).toContainText('left of 2.000.000');
  await expect(line(page, 'Restaurants').getByTestId('budget-repeat')).toHaveCount(0);
  await shot(page, 'budget-november');

  // The sheet opens on what was typed, the way it repeats.
  const again = await openCapOf(page, 'Pocket money');
  await expect(again.getByLabel('Cap', { exact: true })).toHaveValue('100.000');
  await expect(again.getByLabel('Every', { exact: true })).toHaveValue('weekly');
  await expect(again.getByLabel('Starts on')).toHaveCount(0);
  await shot(page, 'edit-sheet-weekly');
  await page.keyboard.press('Escape');

  // December: 4 Mondays, 31 days, one token date.
  await page.goto('/budget?month=2026-12');
  for (const parent of ['Education', 'Food and beverage', 'Utilities']) await openDrawer(page, parent);
  await expect(line(page, 'Pocket money')).toContainText('left of 400.000');
  await expect(line(page, 'Cafe & dessert')).toContainText('left of 1.550.000');
  await expect(line(page, 'Electricity')).toContainText('left of 1.000.000');
  await expect(line(page, 'Restaurants')).toContainText('left of 2.000.000');
  await shot(page, 'budget-december');

  // Edit budgets keeps each row's unit, and every 3 weeks shows as such.
  await page.goto('/budget?month=2026-11');
  await page.getByRole('button', { name: 'Edit budgets', exact: true }).first().click();
  const screen = page.getByTestId('edit-budgets');
  await expect(screen.getByLabel('Electricity every')).toHaveValue('weeks-3');
  await expect(screen.getByLabel('Pocket money every')).toHaveValue('weekly');
  await expect(screen.getByLabel('Cafe & dessert every')).toHaveValue('daily');
  // The screen is long: the shot is the part around Electricity, as it is seen.
  await screen.getByTestId('edit-row-Electricity').scrollIntoViewIfNeeded();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/edit-budgets.png` });
});
