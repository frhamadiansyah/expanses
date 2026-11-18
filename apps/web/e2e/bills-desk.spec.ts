import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';
import { pickBillCategory, pickBillPaidFrom, showRepeating } from './bill-form';
import { addFarYearlyBill, addMonthlyBill } from './recurring-slider';
import { deskRow, paySeveral, peekBill, peekButton, toPayRow } from './bills-desk';

/*
 * Bills on a wide screen (Mac Bills, list + calendar together): the month's box, the calendar, the All bills table with
 * its ticks and its side peek. Invented figures.
 */

test.beforeEach(async ({ page }, info) => {
  page.on('dialog', (dialog) => void dialog.accept());
  // The yearly walk opens its own account.
  if (!info.title.startsWith('Yearly bills')) await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '20000000' });
});

async function addBill(page: Page, options: { name: string; amount: string; out?: number }) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(options.name);
  await page.getByLabel('Amount', { exact: true }).fill(options.amount);
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Bill date').selectOption(String(options.out ?? 1));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(deskRow(page, options.name)).toBeVisible();
}

const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
};
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });

test('two bills ticked are paid together, and the month’s box, the groups and the bar follow', async ({ page }) => {
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  await addBill(page, { name: 'Gym', amount: '250000' });
  await expect(page.getByTestId('bills-page')).toHaveAttribute('data-desk', 'true');
  await expect(page.getByRole('heading', { name: 'Bills', level: 1 })).toBeVisible();

  // The box adds up the rows still to pay; nothing is paid yet.
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s795\.000$/);
  await expect(page.getByTestId('bills-month-total')).toHaveText(/^Paid Rp\s0 of Rp\s795\.000 · 0 of 3$/);

  const sheet = await paySeveral(page, ['Phone', 'Internet']);
  await expect(page.getByTestId('select-total')).toHaveText(/^Rp\s545\.000$/);
  await expect(sheet.getByRole('checkbox')).toHaveCount(2);
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText('Paid 2 bills');
  await expect(page.getByTestId('select-bar')).toHaveCount(0);

  // Paid, the two move to Paid this month; the box says what is left and what was paid, and the two add up.
  const paid = page.getByTestId('bills-paid');
  await expect(paid.getByRole('cell', { name: 'Paid this month' })).toBeVisible();
  await expect(paid.getByTestId('bill-row')).toHaveCount(2);
  await expect(paid.getByTestId('bill-row').filter({ hasText: 'Phone' }).getByTestId('bill-status')).toHaveText(/^Paid \d+ \w{3}$/);
  await expect(toPayRow(page, 'Gym')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Select Phone' })).toHaveCount(0);
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s250\.000$/);
  await expect(page.getByTestId('bills-month-total')).toHaveText(/^Paid Rp\s545\.000 of Rp\s795\.000 · 2 of 3$/);

  // Undo takes both back.
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId('bills-paid')).toHaveCount(0);
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s795\.000$/);
});

test('Due soon is what is late or due within 3 days, out yet or not; the calendar, the sidebar and the rest agree', async ({ page }) => {
  const at = (days: number) => {
    const day = new Date();
    day.setDate(day.getDate() + days);
    return day;
  };
  // Both bills must fall in this month for the walk to mean anything (not in the last four days of a month).
  test.skip(at(4).getMonth() !== new Date().getMonth(), 'today + 4 is next month');
  await addBill(page, { name: 'PLN', amount: '420000', out: at(3).getDate() });
  await addBill(page, { name: 'Internet', amount: '395000', out: at(4).getDate() });

  // Not out yet, due in 3 days: Due soon, in its words and colour, and orange on the calendar.
  const soon = page.getByTestId('bills-due-soon');
  await expect(soon.getByTestId('bill-row')).toHaveCount(1);
  await expect(soon.getByTestId('bill-row').filter({ hasText: 'PLN' }).getByTestId('bill-status')).toHaveText('Due in 3 days');
  const later = page.getByTestId('bills-later');
  await expect(later.getByTestId('bill-row').filter({ hasText: 'Internet' }).getByTestId('bill-status')).toHaveText('In 4 days');
  const date = (day: Date) => `${thisMonth()}-${pad(day.getDate())}`;
  await expect(page.getByTestId('bills-calendar').locator(`[data-date="${date(at(3))}"]`)).toHaveAttribute('data-mark', 'soon');
  await expect(page.getByTestId('bills-calendar').locator(`[data-date="${date(at(4))}"]`)).toHaveAttribute('data-mark', 'later');
  // The sidebar's Bills count is Due soon's.
  await expect(page.locator('aside').getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: /^Bills/ })).toHaveText(/^Bills\s*1$/);
  // The month's box still counts both, and the line under the bars says what the month has due.
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s815\.000$/);
  await expect(page.getByTestId('bills-trend')).toHaveText(/^\w+: Rp\s815\.000 due · \w+ paid Rp\s0$/);
  // The peek says when it is due in the table's words, not a date.
  await expect((await peekBill(page, 'PLN')).getByTestId('peek-due')).toHaveText('Due in 3 days');
  await expect((await peekBill(page, 'Internet')).getByTestId('peek-due')).toHaveText('In 4 days');
});

test('a day picked on the calendar lists its bills and lights their rows', async ({ page }) => {
  await addBill(page, { name: 'Phone', amount: '150000', out: 1 });
  await addBill(page, { name: 'Rent', amount: '5000000', out: 28 });
  const day = page.getByTestId('bills-calendar').locator(`[data-date="${thisMonth()}-28"]`);
  // Each day a bill is due carries a mark.
  await expect(day).toHaveAttribute('data-mark', /^(soon|later)$/);
  await expect(page.getByTestId('bills-calendar').locator(`[data-date="${thisMonth()}-01"]`)).toHaveAttribute('data-mark', /^(soon|later)$/);
  await expect(page.getByTestId('bills-calendar').locator(`[data-date="${thisMonth()}-15"]`)).not.toHaveAttribute('data-mark', /.+/);

  await day.click();
  await expect(day).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('calendar-day')).toContainText('Rent');
  await expect(page.getByTestId('calendar-day')).toContainText(/Rp\s5\.000\.000/);
  await expect(page.getByTestId('calendar-day')).not.toContainText('Phone');
  await expect(deskRow(page, 'Rent')).toHaveAttribute('data-on-day', 'true');
  await expect(deskRow(page, 'Phone')).not.toHaveAttribute('data-on-day', /.+/);

  // A second click lets the day go.
  await day.click();
  await expect(page.getByTestId('calendar-day')).toHaveCount(0);
  await expect(deskRow(page, 'Rent')).not.toHaveAttribute('data-on-day', /.+/);
});

test('a row opens its bill in the side peek: arrows step, Esc closes, Pay and Skip work there, a double-click opens the page', async ({ page }) => {
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });

  const peek = await peekBill(page, 'Internet');
  await expect(peek.getByTestId('peek-amount')).toHaveText(/^Rp\s395\.000$/);
  await expect(peek).toContainText('Every month');
  await expect(deskRow(page, 'Internet')).toHaveAttribute('aria-current', 'true');
  // The page makes room for the peek (a moment after it opens, past a double-click): the table is not under it.
  await expect
    .poll(async () => {
      const peekBox = (await peek.boundingBox())!;
      const tableBox = (await page.getByTestId('all-bills').boundingBox())!;
      return tableBox.x + tableBox.width <= peekBox.x;
    })
    .toBe(true);

  await page.keyboard.press('ArrowDown');
  await expect(peek.getByTestId('peek-title')).toContainText('Phone');
  await page.keyboard.press('ArrowUp');
  await expect(peek.getByTestId('peek-title')).toContainText('Internet');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('bill-peek')).toHaveCount(0);

  await peekBill(page, 'Phone');
  await peekButton(page, 'Pay').click();
  const pay = page.getByRole('dialog', { name: 'Pay Phone' });
  await pay.getByRole('button', { name: 'Record payment' }).click();
  await expect(pay).toHaveCount(0);
  await expect(toast(page)).toContainText('Paid Phone');
  await expect(page.getByTestId('bills-paid')).toContainText('Phone');
  // The peek stays on the bill, now paid, with the payment in its history.
  await expect(page.getByTestId('peek-status')).toContainText('Paid');
  await expect(page.getByTestId('peek-history')).toContainText('150.000');
  // A paid month opens its payment's receipt (the Mac receipt) in the bill's peek's place, with ‹ back to the bill.
  await page.getByTestId('peek-history-row').filter({ hasText: '150.000' }).click();
  const receipt = page.getByTestId('receipt-peek');
  await expect(receipt.getByTestId('peek-amount')).toHaveText(/^Rp\s150\.000$/);
  await expect(receipt.getByTestId('receipt-bill')).toContainText('Linked');
  await expect(page).toHaveURL(/\/bills/);
  await receipt.getByRole('button', { name: 'Back to Phone' }).click();
  await expect(receipt).toHaveCount(0);
  await expect(page.getByTestId('bill-peek').getByTestId('peek-title')).toContainText('Phone');

  await peekBill(page, 'Internet');
  await peekButton(page, 'Skip').click();
  await expect(toast(page)).toContainText('Skipped Internet this month');
  await expect(page.getByTestId('bills-paid').getByTestId('bill-row').filter({ hasText: 'Internet' }).getByTestId('bill-status')).toHaveText('Skipped');

  await deskRow(page, 'Phone').dblclick();
  await expect(page).toHaveURL(/\/bills\/[^/?]+$/);
  await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();
});

test('the title bar’s month: next month’s bills are listed to come, with nothing to tick', async ({ page }) => {
  // Out on the 10th, so next month's is never within the 3 days of Due soon, whatever today is.
  await addBill(page, { name: 'Phone', amount: '150000', out: 10 });
  const month = page.getByTestId('bills-month');
  const was = await month.textContent();
  await page.getByRole('button', { name: 'Next month', exact: true }).click();
  await expect(month).not.toHaveText(was!);
  await expect(page.getByTestId('bills-later')).toContainText('Phone');
  await expect(deskRow(page, 'Phone').getByTestId('bill-status')).toHaveText(/^In \d+ days?$/);
  await expect(page.getByRole('checkbox', { name: 'Select Phone' })).toHaveCount(0);
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s150\.000$/);
  // The bars end at the month shown, hatched: still to come.
  await expect(page.getByTestId('bills-bar').last()).toHaveAttribute('data-minor', /^[1-9]/);

  await page.getByRole('button', { name: 'Previous month', exact: true }).click();
  await expect(month).toHaveText(was!);
  await expect(page.getByRole('checkbox', { name: 'Select Phone' })).toBeVisible();
});

test('Pause in the peek moves a bill to Paused and out of the box; Resume brings it back', async ({ page }) => {
  await addBill(page, { name: 'Gym', amount: '350000' });
  await addBill(page, { name: 'Phone', amount: '150000' });
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s500\.000$/);

  await peekBill(page, 'Gym');
  await peekButton(page, 'Pause').click();
  const sheet = page.getByRole('dialog', { name: 'Pause' });
  await sheet.getByRole('radio', { name: '2 months' }).click();
  await sheet.getByRole('button', { name: 'Pause Gym' }).click();
  await expect(sheet).toHaveCount(0);

  const paused = page.getByTestId('bills-paused');
  await expect(paused.getByTestId('bill-row').filter({ hasText: 'Gym' }).getByTestId('bill-status')).toHaveText(/^Paused until \w{3} \d{4}$/);
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s150\.000$/);
  await expect(page.getByTestId('bills-month-total')).toHaveText(/ · 0 of 1$/);
  await expect(page.getByRole('checkbox', { name: 'Select Gym' })).toHaveCount(0);

  await peekButton(page, 'Resume').click();
  await expect(page.getByTestId('bills-paused')).toHaveCount(0);
  await expect(page.getByTestId('bills-total')).toHaveText(/^Rp\s500\.000$/);
});

test('Yearly bills in the title bar lists the repeating bills all year; one far off is not in the month’s table', async ({ page }) => {
  await addFarYearlyBill(page, 'Domain');
  await addMonthlyBill(page, 'Water');
  await expect(deskRow(page, 'Water')).toBeVisible();
  await expect(deskRow(page, 'Domain')).toHaveCount(0);
  await expect(page.getByTestId('bills-set-aside')).toContainText('Nothing set aside yet');

  await showRepeating(page);
  const domain = page.getByTestId('yearly-bill-row').filter({ hasText: 'Domain' });
  await expect(domain).toContainText('3.000.000');
  await domain.click();
  await expect(page.getByRole('heading', { name: 'Domain' })).toBeVisible();
  await page.goBack();
  await page.goBack();
  await expect(deskRow(page, 'Water')).toBeVisible();
});
