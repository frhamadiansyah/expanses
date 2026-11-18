import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu } from './add-transaction';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';

/*
 * Yearly bills on Cashflow (owner, 2026-11-18, mockup docs/mockups/2026-11-18-yearly-bills-month-year.html): a month
 * leaves a paid yearly bill out of its ring and total but lists it, greyed, with "Yearly bill · in the year"; the ⋯
 * menu's Yearly bills switch counts it; a year counts it as its own category's slice. Invented figures, pinned to
 * March 2027.
 */

const SHOTS = process.env.YEARLY_SHOTS;

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** A horizontal drag across the row, in small steps, the way a thumb moves (as phone-recurring-bills.spec.ts does). */
async function swipe(page: Page, target: Locator, dx: number) {
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) await page.mouse.move(x + (dx * step) / 10, y);
  await page.mouse.up();
}

async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  // The install hint and the backup banner are put away first, so the picture is the page itself.
  const dismiss = page.getByRole('status').getByRole('button', { name: 'Dismiss' });
  for (let i = 0; i < 3 && (await dismiss.count()) > 0; i += 1) await dismiss.first().click({ timeout: 2000 }).catch(() => undefined);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/yearly-${name}-${scheme}.png`, fullPage: name !== 'filter' });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const total = (page: Page) => page.getByTestId('period-total');
const premium = (page: Page) => page.getByTestId('transaction-row').filter({ hasText: 'Life cover premium' });

test('a yearly bill is listed in grey and left out of the month, counted with the switch on, and in the year', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2027-03-05T12:00:00'));
  await openAccount(page, { subtype: 'bank', name: 'Contoh Tabungan', balance: '50000000' });

  // A yearly bill out on 5 March, paid from its own row.
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Life cover premium');
  await page.getByLabel('Amount', { exact: true }).fill('12000000');
  await pickBillCategory(page, 'Life insurance');
  await pickBillPaidFrom(page, 'Contoh Tabungan');
  await page.getByLabel('Repeats').selectOption('yearly');
  await page.getByLabel('Month', { exact: true }).selectOption('3');
  await page.getByLabel('Due by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  const bill = page.locator('[data-testid="bill-row"]:not([data-testid="bills-paid"] *)').filter({ hasText: 'Life cover premium' });
  await swipe(page, bill, 140);
  await page.getByRole('dialog', { name: 'Pay Life cover premium' }).getByRole('button', { name: 'Record payment' }).click();
  // Not any status: the install hint and the backup banner are statuses too (as phone-recurring-bills.spec.ts reads it).
  await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) })).toContainText('Paid Life cover premium');

  // Everyday spending the day before.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Contoh', paidWith: 'Contoh Tabungan', category: 'Restaurants', amount: '286000', date: '2027-03-04' });

  // March: the ring and its total are the dinner alone; the bill is still on the list, whole and grey.
  await expect(page.getByTestId('chart-month')).toHaveText(/March 2027/);
  await expect(total(page)).toHaveText('Rp 286.000');
  await expect(premium(page)).toHaveCount(1);
  await expect(premium(page)).toContainText('Rp 12.000.000');
  await expect(premium(page).getByTestId('amount-extra')).toHaveText('Yearly bill · in the year');
  const amount = premium(page).getByText('Rp 12.000.000', { exact: true });
  await expect(amount).not.toHaveClass(/text-red-700/);
  await expect(amount).toHaveClass(/text-slate-500/);
  await expect(page.getByTestId('yearly-bills-note')).toHaveText('1 yearly bill not in the ring');
  // Its day adds nothing: a day with only the yearly bill says Rp 0; the dinner's day is its own figure.
  const dayCard = (name: string) => page.getByTestId('transaction-row').filter({ hasText: name }).locator('xpath=ancestor::*[.//span[contains(@class,"text-2xl")]][1]');
  const fifth = dayCard('Life cover premium');
  await expect(fifth).toContainText('Friday');
  await expect(fifth.getByTestId('day-total')).toHaveText('Rp 0');
  await expect(dayCard('Sate Contoh').getByTestId('day-total')).toHaveText('Rp 286.000');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'march');

  // Filter: Yearly bills off by default, saying what that means; on, the month counts it like any spending.
  await historyMenu(page).click();
  const menu = page.getByTestId('sort-filter-menu');
  const yearly = menu.getByTestId('yearly-bills-filter');
  await expect(yearly).toHaveAttribute('aria-checked', 'false');
  await expect(yearly).toContainText('Off: listed, not in the ring or total');
  await shoot(page, 'filter');
  await yearly.click();
  await expect(total(page)).toHaveText('Rp 12.286.000');
  await expect(page.getByTestId('yearly-bills-note')).toHaveCount(0);
  await expect(premium(page).getByTestId('amount-extra')).toHaveCount(0);
  await expect(premium(page).getByText('Rp 12.000.000', { exact: true })).toHaveClass(/text-red-700/);
  await expect(fifth.getByTestId('day-total')).toHaveText('Rp 12.000.000');
  await expect(page.getByTestId('filter-on')).toBeVisible();
  // Kept on this device: a fresh visit still counts it.
  await page.goto('/transactions');
  await expect(total(page)).toHaveText('Rp 12.286.000');
  // Back off.
  await historyMenu(page).click();
  await page.getByTestId('yearly-bills-filter').click();
  await expect(total(page)).toHaveText('Rp 286.000');

  // The year counts it, switch off, as its own category's slice; the menu says a year always counts them.
  await page.getByTestId('chart-month').click();
  const picker = page.getByTestId('period-picker');
  await picker.getByRole('tab', { name: 'Year' }).click();
  await picker.getByRole('button', { name: '2027', exact: true }).click();
  await expect(page.getByTestId('chart-month')).toHaveText(/2027/);
  await expect(total(page)).toHaveText('Rp 12.286.000');
  await expect(page.getByTestId('yearly-bills-note')).toHaveCount(0);
  await expect(premium(page).getByTestId('amount-extra')).toHaveCount(0);
  await page.getByTestId('see-categories').first().click();
  await expect(page.getByTestId('report-row').filter({ hasText: 'Protection' })).toContainText('12.000.000');
  await historyMenu(page).click();
  await expect(page.getByTestId('yearly-bills-filter')).toBeDisabled();
  await expect(page.getByTestId('yearly-bills-filter')).toContainText('A year always counts them');
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'year');
});
