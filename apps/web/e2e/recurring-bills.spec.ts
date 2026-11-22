import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';
import { paySeveral, peekBill, peekButton } from './bills-desk';

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

async function addWallet(page: Page, name: string) {
  await openAccount(page, { subtype: 'bank', name, balance: '20000000' });
}

/** Bills are set up on their own page. Out on the 1st unless told otherwise, so the bill is always out. */
async function addBill(page: Page, options: { name: string; amount?: string; out?: number; payBy?: number }) {
  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill(options.name);
  if (options.amount !== undefined) await page.getByLabel('Amount', { exact: true }).fill(options.amount);
  // Whichever category is first: the point is the bill, not which category it lands in.
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByLabel('Bill date').selectOption(String(options.out ?? 1));
  if (options.payBy !== undefined) await page.getByLabel('Due by').selectOption(String(options.payBy));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bill-row').filter({ hasText: options.name })).toBeVisible();
}

/** A row among the bills still to deal with: not one in the Paid group. */
const row = (page: Page, name: string) => page.locator('[data-testid="bill-row"]:not([data-testid="bills-paid"] *)').filter({ hasText: name });

/** The bill page's round buttons. */
const action = (page: Page, name: string | RegExp) => page.getByRole('group', { name: 'Actions' }).getByRole(typeof name === 'string' && name === 'Edit' ? 'link' : 'button', { name });

/** A line of the bill page's details: its label and what it says. */
const detail = (page: Page, label: string) => page.locator('div').filter({ hasText: new RegExp(`^${label}`) }).last();

/** The Paid group: the month's paid and skipped bills, listed as ordinary rows (the table's Paid this month). */
const paidGroup = (page: Page) => page.getByTestId('bills-paid');

/** The undo toast. Not any status: the install hint and the backup banner are statuses too. */
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });

/** The desktop way to a row's actions (Mac Bills): the row opens the bill's side peek, where Pay and Skip are. */
async function rowAction(page: Page, name: string, action: RegExp) {
  await peekBill(page, name);
  await peekButton(page, action).click();
}

/** A row's bill on its own page: a double-click on a wide screen (a single click opens the side peek). */
const openBill = (page: Page, name: string) => row(page, name).dblclick();

/**
 * Cashflow's bills card is the phone's: a wide screen's Cashflow (Mac Cashflow D) has Bills in its sidebar instead. The
 * window is narrowed to a phone's for the look, and widened again by whoever needs the desk after it.
 */
async function phoneCashflow(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/transactions');
}

test('the Cashflow card counts the month’s bills', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  // The card counts it before anything is done about it. It is the phone's Cashflow (Mac Cashflow D has none).
  await phoneCashflow(page);
  await expect(page.getByTestId('recurring-card')).toContainText('0 of 1 bill paid');
  await expect(page.getByTestId('recurring-card')).toContainText('150.000');
});

test('a bill keeps its pay-by day through an edit', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 28, payBy: 5 });
  await openBill(page, 'Biznet Home');
  await action(page, 'Edit').click();
  await expect(page.getByRole('heading', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByLabel('Bill date')).toHaveValue('28');
  await expect(page.getByLabel('Due by')).toHaveValue('5');
  await page.getByLabel('Due by').selectOption('');
  await page.getByRole('button', { name: 'Save' }).click();
  // Save on an edit returns to the bill's own page, not the list — Edit bill is reached from there directly.
  await action(page, 'Edit').click();
  await expect(page.getByLabel('Due by')).toHaveValue('');
});

test('a bill’s page pays its month and stays, with the payment and an undo', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 1, payBy: 28 });
  await openBill(page, 'Biznet Home');

  await expect(page.getByRole('heading', { name: 'Biznet Home' })).toBeVisible();
  await expect(detail(page, 'Out on')).toContainText('The 1st');
  await expect(detail(page, 'Due by')).toContainText('The 28th');
  await expect(detail(page, 'Repeats')).toContainText('Every month');
  await action(page, 'Pay').click();
  await page.getByRole('dialog', { name: 'Pay Biznet Home' }).getByRole('button', { name: 'Record payment' }).click();

  await expect(page.getByRole('dialog', { name: 'Pay Biznet Home' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  const banner = page.getByTestId('just-paid');
  await expect(banner).toContainText(/Paid .*450\.000/);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText('450.000');
  // The page stays: the card says Paid, and Pay moves on to the next month.
  await expect(page.getByTestId('bill-status')).toContainText('Paid');
  await expect(action(page, /^Pay \w+$/)).toBeVisible();

  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(banner).toHaveCount(0);
  await expect(action(page, 'Pay')).toBeVisible();
});

test('from a bill’s page: skip its month, edit it, and stop it', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Gym', amount: '350000' });
  await openBill(page, 'Gym');
  await expect(page.getByText('Paid from')).toBeVisible();

  await action(page, 'Skip').click();
  await expect(page.getByTestId('bill-hero')).toContainText('Skipped');

  await action(page, 'Edit').click();
  await page.getByLabel('Due by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(detail(page, 'Due by')).toContainText('The 5th');

  // Stopping is a row at the foot of Edit bill; the bill page's corner has no menu any more.
  await expect(page.getByRole('button', { name: 'More', exact: true })).toHaveCount(0);
  await action(page, 'Edit').click();
  await page.getByRole('button', { name: 'Stop this bill' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(row(page, 'Gym')).toHaveCount(0);
});

test('a skipped row still opens the bill: its peek, and its page on a double-click', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Netflix', amount: '120000' });
  await rowAction(page, 'Netflix', /^Skip/);
  await expect(paidGroup(page).getByRole('cell', { name: 'Paid this month' })).toBeVisible();
  const sheet = paidGroup(page);
  const skipped = sheet.getByTestId('bill-row').filter({ hasText: 'Netflix' });
  await expect(skipped).toContainText('Skipped');
  await skipped.click();
  await expect(page.getByTestId('bill-peek')).toContainText('Skipped');
  await skipped.dblclick();
  await expect(page.getByRole('heading', { name: 'Netflix' })).toBeVisible();
});

test('a bill that is out is paid from its row, and the month is settled', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  await phoneCashflow(page);
  await page.getByTestId('recurring-card').click();
  await expect(page).toHaveURL(/\/bills\?from=cashflow$/);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(page.getByTestId('bills-summary')).toContainText('left to pay');
  await expect(page.getByTestId('bills-total')).toContainText('150.000');
  await expect(page.getByTestId('bills-month-total')).toContainText(/of Rp\s150\.000 · 0 of 1/);

  await rowAction(page, 'Phone', /^Pay/);
  const sheet = page.getByRole('dialog', { name: 'Pay Phone' });
  await expect(sheet.getByLabel('What it came to')).not.toHaveValue('');
  await sheet.getByRole('button', { name: 'Record payment' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText('Paid Phone');
  // Paid, it leaves the list for the one row that counts what is done.
  await expect(row(page, 'Phone')).toHaveCount(0);
  await expect(paidGroup(page)).toContainText('Phone');
  await expect(paidGroup(page)).toContainText('150.000');
  await expect(page.getByTestId('bills-summary')).toContainText('All paid for');
  const sheet2 = paidGroup(page);
  await expect(sheet2.getByTestId('bill-row').filter({ hasText: 'Phone' })).toContainText(/Paid \d+ \w{3}/);
  // A double-click on a paid bill opens its page.
  await sheet2.getByTestId('bill-row').filter({ hasText: 'Phone' }).dblclick();
  await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();

  await phoneCashflow(page);
  await expect(page.getByTestId('recurring-card')).toContainText('1 of 1 bill paid');
  await expect(page.getByRole('listitem').filter({ hasText: 'Phone' }).first()).toBeVisible();
});

test('undo takes a payment back', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await rowAction(page, 'Phone', /^Pay/);
  await page.getByRole('dialog', { name: 'Pay Phone' }).getByRole('button', { name: 'Record payment' }).click();
  await expect(paidGroup(page)).toBeVisible();
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(paidGroup(page)).toHaveCount(0);
  await expect(row(page, 'Phone')).toBeVisible();
});

test('a bill that varies asks what it came to', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Electricity' });
  await expect(row(page, 'Electricity')).toContainText('Amount varies');
  await expect(page.getByTestId('bills-summary')).not.toContainText('vary');

  await rowAction(page, 'Electricity', /^Pay/);
  const sheet = page.getByRole('dialog', { name: 'Pay Electricity' });
  await expect(sheet.getByLabel('What it came to')).toHaveValue('');
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toContainText('Enter what it came to');
  await sheet.getByLabel('What it came to').fill('432000');
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(sheet).toHaveCount(0);

  await page.goto('/transactions');
  await expect(page.getByRole('listitem').filter({ hasText: '432.000' }).first()).toBeVisible();
});

test('a month can be skipped, and the skip undone', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Fitness First', amount: '850000' });
  await rowAction(page, 'Fitness First', /^Skip/);
  await expect(toast(page)).toContainText('Skipped Fitness First this month');
  await expect(row(page, 'Fitness First')).toHaveCount(0);
  await expect(paidGroup(page).getByTestId('bill-row').filter({ hasText: 'Fitness First' })).toContainText('Skipped');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Fitness First')).toBeVisible();
  await expect(paidGroup(page)).toHaveCount(0);
});

test('several bills are ticked and recorded together, on the day they were paid', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Electricity' });

  // On a wide screen every bill to pay has its tick; the bar under the table pays them.
  const sheet = await paySeveral(page, ['Phone', 'Electricity']);
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toContainText('Enter the amount of each ticked bill that varies');
  await sheet.getByLabel('What Electricity came to').fill('432000');
  const paidOn = new Date(Date.now() - 2 * 86_400_000);
  const iso = `${paidOn.getFullYear()}-${String(paidOn.getMonth() + 1).padStart(2, '0')}-${String(paidOn.getDate()).padStart(2, '0')}`;
  await sheet.getByLabel('Paid on').fill(iso);
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText('Paid 2 bills');
  await expect(page.getByRole('heading', { name: 'Bills', level: 1 })).toBeVisible();
  await phoneCashflow(page);
  await expect(page.getByTestId('recurring-card')).toContainText('2 of 2 bills paid');
});

test('Pay several: Paid with makes one account pay every ticked bill, and the default leaves each bill with its own', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await openAccount(page, { subtype: 'bank', name: 'Jenius', balance: '20000000' });
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Electricity' });
  const sheet = await paySeveral(page, ['Phone', 'Electricity']);
  // Untouched, the row says every bill keeps its own account.
  await expect(sheet.getByTestId('several-with')).toContainText("Each bill's own account");
  await sheet.getByTestId('several-with').getByRole('button').click();
  const list = page.getByRole('dialog', { name: 'Payment method' });
  await expect(list.getByText("Each bill's own account")).toBeVisible();
  await expect(list.getByText('Accounts', { exact: true })).toBeVisible();
  await expect(list.getByRole('button', { name: /Jenius/ })).toBeVisible();
  await list.getByRole('button', { name: /Jenius/ }).click();
  await expect(list).toHaveCount(0);
  await expect(sheet.getByTestId('several-with')).toContainText('Jenius');
  await sheet.getByLabel('What Electricity came to').fill('432000');
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toHaveCount(0);
  // Both bills left Jenius; BCA, the bills' own account, was not touched.
  await page.goto('/accounts');
  await openTypes(page);
  await expect(page.getByRole('link', { name: 'Jenius, Rp 19.418.000' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'BCA Tahapan, Rp 20.000.000' })).toBeVisible();
});

test('unticking a bill in Pay several leaves it unpaid', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  const sheet = await paySeveral(page, ['Phone']);
  // Only the selected bill is listed; the rest of the month's unpaid bills are not offered.
  await expect(sheet.getByRole('checkbox', { name: 'Pay Internet' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(row(page, 'Internet')).toBeVisible();
  await expect(row(page, 'Phone')).toHaveCount(0);
  await expect(paidGroup(page).getByTestId('bill-row')).toHaveCount(1);
  await expect(paidGroup(page)).toContainText('Phone');
});

test('a bill not out yet is listed to come later, and can be paid early', async ({ page }) => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  test.skip(now.getDate() >= last, 'Nothing is still to come on the last day of a month');
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Housing rent', amount: '5000000', out: 31 });
  // The table's Later this month (the phone lists it with Due soon): not late, not soon, counted to its day.
  await expect(page.getByTestId('bills-later')).toContainText('Housing rent');
  await expect(row(page, 'Housing rent').getByTestId('bill-status')).toHaveText(/^In \d+ days?$/);
  await rowAction(page, 'Housing rent', /^Pay/);
  await expect(page.getByRole('dialog', { name: 'Pay Housing rent' })).toBeVisible();
});

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

test('last month’s overdue bill paid from its page says so, can be undone, and is tagged in the history', async ({ page }) => {
  const now = new Date();
  const earlier = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12);
  const lastMonth = MONTHS[earlier.getMonth()]!;
  const thisMonth = MONTHS[now.getMonth()]!;
  // The bill is set up last month, so last month's bill is owed and, with no pay-by day, overdue by now.
  await page.clock.setSystemTime(earlier);
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 1 });
  await page.clock.setSystemTime(now);

  await page.goto('/bills');
  // Late, it is with Due soon at the top of the table.
  await expect(page.getByTestId('bills-due-soon')).toContainText('Biznet Home');
  await expect(row(page, 'Biznet Home').getByTestId('bill-status')).toHaveText(/^\d+ days? late$/);
  await openBill(page, 'Biznet Home');
  await expect(page.getByTestId('bill-hero')).toContainText(`${lastMonth} bill`);
  // The standing is in the line under the amount, not a pill: the late words, then the due date.
  await expect(page.getByTestId('bill-hero').getByTestId('bill-status')).toContainText(/^Overdue \d+ days? · due \d+ \w{3} 20\d\d$/);
  await action(page, 'Pay').click();
  const sheet = page.getByRole('dialog', { name: 'Pay Biznet Home' });
  await expect(sheet.getByLabel('For')).toHaveValue(new RegExp(`-${String(earlier.getMonth() + 1).padStart(2, '0')}$`));
  await sheet.getByRole('button', { name: 'Record payment' }).click();

  // The page moves on to this month's bill; the confirmation stays with the one just paid.
  const banner = page.getByTestId('just-paid');
  await expect(banner).toContainText(/Paid .*450\.000/);
  await expect(banner).toContainText(`${lastMonth} bill`);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText(`${lastMonth} bill`);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText('450.000');
  await expect(page.getByTestId('bill-hero')).toContainText(`${thisMonth} bill`);
  await expect(action(page, 'Pay')).toBeVisible();

  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('bill-hero')).toContainText(`${lastMonth} bill`);
  // The standing is in the line under the amount, not a pill: the late words, then the due date.
  await expect(page.getByTestId('bill-hero').getByTestId('bill-status')).toContainText(/^Overdue \d+ days? · due \d+ \w{3} 20\d\d$/);

  await action(page, 'Pay').click();
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(banner).toContainText(`${lastMonth} bill`);

  // Listed on the day it was paid, plain: no tag naming the bill's month on the row (the budget still counts it there).
  // On a wide screen Cashflow is the table (Mac Cashflow D), so this row is the table's.
  await page.goto('/transactions');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Biznet Home' }).first()).toBeVisible();
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Biznet Home' }).first()).not.toContainText(`${lastMonth.slice(0, 3)} bill`);
});

test('Pay several names the bill it recorded, not the one first picked', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  const sheet = await paySeveral(page, ['Phone', 'Internet']);
  await sheet.getByRole('checkbox', { name: 'Pay Phone' }).click();
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();

  await expect(toast(page)).toContainText('Paid Internet');
  await expect(row(page, 'Internet')).toHaveCount(0);
  await expect(row(page, 'Phone')).toBeVisible();
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Internet')).toBeVisible();
  await expect(paidGroup(page)).toHaveCount(0);
});

test('a bill paid from a dollar account keeps its amount through an edit', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD' });

  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Cloud storage');
  await page.getByLabel('Amount', { exact: true }).fill('15');
  await pickBillCategory(page);
  await pickBillPaidFrom(page, 'Wise USD');
  await page.getByLabel('Bill date').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await openBill(page, 'Cloud storage');

  await action(page, 'Edit').click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('15,00');
  await page.getByRole('button', { name: 'Save' }).click();
  // Formatted the Indonesian way, "US$15,00"; the bug read it as rupiah and saved "US$1.500,00".
  await expect(page.getByTestId('bill-hero')).toContainText(/US\$\s?15,00/);
});

test('a new bill starts with no bill date, refuses to save without one, and picks its category in a sheet', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await page.goto('/bills/new');
  await expect(page.getByLabel('Bill date')).toHaveValue('');
  await expect(page.getByLabel('Due by')).toHaveValue('');
  await page.getByLabel('Name', { exact: true }).fill('Water');
  await pickBillCategory(page);
  await expect(page.getByRole('button', { name: /^Category/ })).toContainText('Restaurants');
  await pickBillPaidFrom(page, 'BCA Tahapan');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Choose the bill date')).toBeVisible();
  await expect(page).toHaveURL(/\/bills\/new$/);
  await page.getByLabel('Bill date').selectOption('1');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
});

test('Pay several lists only the selected bills: 3 bills, 2 selected, 2 shown', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  await addBill(page, { name: 'Gym', amount: '250000' });

  const sheet = await paySeveral(page, ['Phone', 'Gym']);
  // The bills' ticks: One payment's switch is a checkbox too.
  await expect(sheet.getByRole('checkbox', { name: /^Pay / })).toHaveCount(2);
  await expect(sheet.getByRole('checkbox', { name: 'Pay Phone' })).toBeChecked();
  await expect(sheet.getByRole('checkbox', { name: 'Pay Gym' })).toBeChecked();
  await expect(sheet.getByRole('checkbox', { name: 'Pay Internet' })).toHaveCount(0);
});

test('the bill amount groups thousands as typed', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await page.goto('/bills/new');
  await page.getByLabel('Amount', { exact: true }).fill('1500000');
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('1.500.000');
});
