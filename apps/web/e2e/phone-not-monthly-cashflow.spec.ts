import { expect, type Locator, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, historyMenu } from './add-transaction';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';

/*
 * Not-monthly costs on Cashflow (owner, 2026-11-18, mockup docs/mockups/2026-11-18-not-monthly-costs-v2.html option D):
 * a month leaves a paid bill that repeats yearly or every 2 months or more out of its ring and total but lists it, its
 * amount grey and a small ↻ on its category's circle; the ⋯ menu's Not monthly (Hidden / Shown) counts it; a year counts
 * it as its own category's slice and offers no Not monthly row. Invented figures, pinned to March 2027.
 */

const SHOTS = process.env.NOT_MONTHLY_SHOTS;

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
    await page.screenshot({ path: `${SHOTS}/notmonthly-${name}-${scheme}.png`, fullPage: !name.startsWith('menu') });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

const total = (page: Page) => page.getByTestId('period-total');
const row = (page: Page, name: string) => page.getByTestId('transaction-row').filter({ hasText: name });
const unpaid = (page: Page, name: string) => page.locator('[data-testid="bill-row"]:not([data-testid="bills-paid"] *)').filter({ hasText: name });
const footnote = (page: Page) => page.getByTestId('not-monthly-bill-note');

/** A bill out on 5 March, through the form: a yearly one, or one every `every` months starting in March. */
async function addBill(page: Page, name: string, amount: string, category: string, repeat: { yearly: true } | { every: number }) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Amount', { exact: true }).fill(amount);
  await pickBillCategory(page, category);
  await pickBillPaidFrom(page, 'Contoh Tabungan');
  // Every month says nothing under Repeats.
  await expect(footnote(page)).toHaveCount(0);
  if ('yearly' in repeat) {
    await page.getByLabel('Repeats').selectOption('yearly');
    await page.getByLabel('Month', { exact: true }).selectOption('3');
  } else {
    await page.getByLabel('Repeats').selectOption({ label: 'Every few months' });
    await page.getByLabel('Months', { exact: true }).selectOption(String(repeat.every));
    await page.getByLabel('Starting').selectOption('3');
  }
  // Not monthly: one short grey line under Repeats.
  await expect(footnote(page)).toHaveText("Not monthly: left out of a month's ring, counted in the year.");
  await page.getByLabel('Due by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
}

test('a yearly and an every-6-months bill are listed grey with a ↻ and left out of the month; Shown counts them; the year counts them with no row', async ({ page }) => {
  await page.clock.setSystemTime(new Date('2027-03-05T12:00:00'));
  await openAccount(page, { subtype: 'bank', name: 'Contoh Tabungan', balance: '50000000' });

  await addBill(page, 'Life cover premium', '12000000', 'Life insurance', { yearly: true });
  await addBill(page, 'Car service', '1780000', 'Vehicle maintenance', { every: 6 });
  // Each paid from its own row.
  for (const name of ['Life cover premium', 'Car service']) {
    await swipe(page, unpaid(page, name), 140);
    await page.getByRole('dialog', { name: `Pay ${name}` }).getByRole('button', { name: 'Record payment' }).click();
    // Not any status: the install hint and the backup banner are statuses too (as phone-recurring-bills.spec.ts reads it).
    await expect(page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) }).filter({ hasText: `Paid ${name}` })).toBeVisible();
  }
  // Switching an every-month bill's form back to monthly takes the line away again.
  await page.goto('/bills/new');
  await page.getByLabel('Repeats').selectOption({ label: 'Every few months' });
  await expect(footnote(page)).toBeVisible();
  await page.getByLabel('Repeats').selectOption({ label: 'Every month' });
  await expect(footnote(page)).toHaveCount(0);

  // Everyday spending the day before.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Sate Contoh', paidWith: 'Contoh Tabungan', category: 'Restaurants', amount: '286000', date: '2027-03-04' });

  // March: the ring and its total are the dinner alone; both bills are still on the list, whole and grey, with a ↻.
  await expect(page.getByTestId('chart-month')).toHaveText(/March 2027/);
  await expect(total(page)).toHaveText('Rp 286.000');
  for (const [name, figure] of [['Life cover premium', 'Rp 12.000.000'], ['Car service', 'Rp 1.780.000']] as const) {
    await expect(row(page, name)).toHaveCount(1);
    const amount = row(page, name).getByText(figure, { exact: true });
    await expect(amount).not.toHaveClass(/text-red-700/);
    await expect(amount).toHaveClass(/text-slate-500/);
    // No second line under the amount: the badge on the circle says it.
    await expect(row(page, name).getByTestId('amount-extra')).toHaveCount(0);
    await expect(row(page, name)).not.toContainText('Yearly bill');
    const badge = row(page, name).getByTestId('not-monthly-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('aria-label', 'Not monthly');
    await expect(row(page, name).getByRole('button', { name: `Category for ${name}, not monthly` })).toBeVisible();
  }
  await expect(row(page, 'Sate Contoh').getByTestId('not-monthly-badge')).toHaveCount(0);
  await expect(page.getByTestId('not-monthly-note')).toHaveText('2 not in the ring');
  // Their day adds nothing: a day with only the bills says Rp 0; the dinner's day is its own figure.
  const dayCard = (name: string) => row(page, name).locator('xpath=ancestor::*[.//span[contains(@class,"text-2xl")]][1]');
  const fifth = dayCard('Life cover premium');
  await expect(fifth).toContainText('Friday');
  await expect(fifth.getByTestId('day-total')).toHaveText('Rp 0');
  await expect(dayCard('Sate Contoh').getByTestId('day-total')).toHaveText('Rp 286.000');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'month');

  // ⋯: Not monthly, a grey word like Sort's, Hidden by default, no explanation under it.
  await historyMenu(page).click();
  const menu = page.getByTestId('sort-filter-menu');
  const choice = menu.getByTestId('not-monthly-cycle');
  await expect(choice).toHaveText(/^Not monthly\s*Hidden$/);
  await expect(choice).toHaveAccessibleName('Not monthly, Hidden');
  await expect(menu).not.toContainText('ring');
  await expect(page.getByTestId('filter-on')).toHaveCount(0);
  await shoot(page, 'menu-month');
  // A tap is Shown, the menu left open (as Sort is): the month counts them like any spending.
  await choice.click();
  await expect(choice).toHaveText(/^Not monthly\s*Shown$/);
  await expect(menu).toBeVisible();
  await expect(total(page)).toHaveText('Rp 14.066.000');
  await expect(page.getByTestId('not-monthly-note')).toHaveCount(0);
  await expect(page.getByTestId('not-monthly-badge')).toHaveCount(0);
  await expect(row(page, 'Car service').getByText('Rp 1.780.000', { exact: true })).toHaveClass(/text-red-700/);
  await expect(fifth.getByTestId('day-total')).toHaveText('Rp 13.780.000');
  await expect(page.getByTestId('filter-on')).toBeVisible();
  // Kept on this device: a fresh visit still counts them.
  await page.goto('/transactions');
  await expect(total(page)).toHaveText('Rp 14.066.000');
  // Reset puts it back to Hidden.
  await historyMenu(page).click();
  await expect(page.getByTestId('not-monthly-cycle')).toHaveText(/Shown$/);
  await page.getByTestId('sort-filter-menu').getByRole('menuitem', { name: 'Reset' }).click();
  await expect(total(page)).toHaveText('Rp 286.000');
  await expect(page.getByTestId('filter-on')).toHaveCount(0);

  // The year counts them, as their own categories' slices; the menu has no Not monthly row at all.
  await page.getByTestId('chart-month').click();
  const picker = page.getByTestId('period-picker');
  await picker.getByRole('tab', { name: 'Year' }).click();
  await picker.getByRole('button', { name: '2027', exact: true }).click();
  await expect(page.getByTestId('chart-month')).toHaveText(/2027/);
  await expect(total(page)).toHaveText('Rp 14.066.000');
  await expect(page.getByTestId('not-monthly-note')).toHaveCount(0);
  await expect(page.getByTestId('not-monthly-badge')).toHaveCount(0);
  await page.getByTestId('see-categories').first().click();
  await expect(page.getByTestId('report-row').filter({ hasText: 'Protection' })).toContainText('12.000.000');
  await historyMenu(page).click();
  await expect(page.getByTestId('sort-filter-menu')).toBeVisible();
  await expect(page.getByTestId('not-monthly-cycle')).toHaveCount(0);
  await expect(page.getByTestId('sort-filter-menu')).not.toContainText('Not monthly');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shoot(page, 'menu-year');
  await page.keyboard.press('Escape');
});
