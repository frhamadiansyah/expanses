import { expect, type Page, test } from '@playwright/test';
import { openAccount, openTypes } from './accounts';
import { pickBillCategory, pickBillPaidFrom } from './bill-form';

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

/** The Paid group: the month's paid and skipped bills, listed as ordinary rows. */
const paidGroup = (page: Page) => page.getByTestId('bills-paid');

/** The undo toast. Not any status: the install hint and the backup banner are statuses too. */
const toast = (page: Page) => page.getByRole('status').filter({ has: page.getByRole('button', { name: 'Undo' }) });

/** The desktop way to a row's actions: the ⋯ button, shown on hover and focus. */
async function rowAction(page: Page, name: string, action: RegExp) {
  await row(page, name).hover();
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await page.getByRole('menuitem', { name: action }).click();
}

test('the Cashflow card counts the month’s bills', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  // The card counts it before anything is done about it.
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('0 of 1 bill paid');
  await expect(page.getByTestId('recurring-card')).toContainText('150.000');
});

test('a bill keeps its pay-by day through an edit', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 28, payBy: 5 });
  await row(page, 'Biznet Home').click();
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
  await row(page, 'Biznet Home').click();

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
  await row(page, 'Gym').click();
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

test('a skipped row’s ⋯ menu still opens the bill’s page', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Netflix', amount: '120000' });
  await rowAction(page, 'Netflix', /^Skip/);
  await expect(paidGroup(page).getByRole('heading', { name: 'Paid' })).toBeVisible();
  const sheet = paidGroup(page);
  const skipped = sheet.getByTestId('bill-row').filter({ hasText: 'Netflix' });
  await expect(skipped).toContainText('Skipped');
  await skipped.hover();
  await sheet.getByRole('button', { name: 'Actions for Netflix' }).click();
  await sheet.getByRole('menuitem', { name: /^See bill$/ }).click();
  await expect(page.getByRole('heading', { name: 'Netflix' })).toBeVisible();
});

test('a bill that is out is paid from its row, and the month is settled', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  await page.goto('/transactions');
  await page.getByTestId('recurring-card').click();
  await expect(page).toHaveURL(/\/bills\?from=cashflow$/);
  await expect(page.getByTestId('bills-summary')).toContainText('Still to pay in');
  await expect(page.getByTestId('bills-summary')).toContainText('150.000');
  await expect(page.getByTestId('bills-legend')).toContainText('150.000');
  const before = await page.getByTestId('bills-summary').boundingBox();

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
  // All paid keeps the box's shape and size (owner, 22 Nov 2026): Rp 0 still to pay, a full green bar, the Paid key.
  await expect(page.getByTestId('bills-total')).toHaveText(/Rp\s?0$/);
  await expect(page.getByTestId('bills-legend')).toContainText('Paid');
  await expect(page.getByTestId('bills-summary')).not.toContainText('All paid');
  expect((await page.getByTestId('bills-summary').boundingBox())?.height).toBe(before?.height);
  const sheet2 = paidGroup(page);
  await expect(sheet2.getByTestId('bill-row').filter({ hasText: 'Phone' })).toContainText(/Paid \d+ \w{3}/);
  // A tap on a paid bill opens its page.
  await sheet2.getByTestId('bill-row').filter({ hasText: 'Phone' }).click();
  await expect(page.getByRole('heading', { name: 'Phone' })).toBeVisible();

  await page.goto('/transactions');
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

  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await expect(page.getByRole('heading', { name: '0 selected' })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('checkbox', { name: 'Select Electricity' }).click();
  await expect(page.getByRole('heading', { name: '2 selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 2 selected/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();
  await expect(sheet).toContainText('Enter the amount of each ticked bill that varies');
  await sheet.getByLabel('What Electricity came to').fill('432000');
  const paidOn = new Date(Date.now() - 2 * 86_400_000);
  const iso = `${paidOn.getFullYear()}-${String(paidOn.getMonth() + 1).padStart(2, '0')}-${String(paidOn.getDate()).padStart(2, '0')}`;
  await sheet.getByLabel('Paid on').fill(iso);
  await sheet.getByRole('button', { name: 'Record 2 bills' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText('Paid 2 bills');
  await expect(page.getByRole('heading', { name: 'Recurring' })).toBeVisible();
  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('2 of 2 bills paid');
});

test('Pay several: Paid with makes one account pay every ticked bill, and the default leaves each bill with its own', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await openAccount(page, { subtype: 'bank', name: 'Jenius', balance: '20000000' });
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Electricity' });
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('checkbox', { name: 'Select Electricity' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 2 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
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
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 1 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  // Only the selected bill is listed; the rest of the month's unpaid bills are not offered.
  await expect(sheet.getByRole('checkbox', { name: 'Pay Internet' })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(row(page, 'Internet')).toBeVisible();
  await expect(row(page, 'Phone')).toHaveCount(0);
  await expect(paidGroup(page).getByTestId('bill-row')).toHaveCount(1);
  await expect(paidGroup(page)).toContainText('Phone');
});

test('a bill not out yet is listed with those due soon, and can be paid early', async ({ page }) => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  test.skip(now.getDate() >= last, 'Nothing is still to come on the last day of a month');
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Housing rent', amount: '5000000', out: 31 });
  await expect(page.getByText('Later', { exact: true })).toHaveCount(0);
  // A plain day under the amount: not late, not soon.
  await expect(row(page, 'Housing rent').getByTestId('bill-status')).toHaveText(/^\d+ \w{3}$/);
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
  await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
  await expect(row(page, 'Biznet Home').getByTestId('bill-status')).toHaveText(/^\d+ days? late$/);
  await expect(page.getByTestId('bills-legend')).toContainText('Overdue');
  await row(page, 'Biznet Home').click();
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
  await page.goto('/transactions');
  await expect(page.getByRole('listitem').filter({ hasText: 'Biznet Home' }).first()).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Biznet Home' }).first()).not.toContainText(`${lastMonth.slice(0, 3)} bill`);
  // Nor in the table on a wide screen.
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByTestId('table-row').first()).toBeVisible();
  await expect(page.getByTestId('table-row').filter({ hasText: `${lastMonth.slice(0, 3)} bill` })).toHaveCount(0);
});

test('Pay several names the bill it recorded, not the one first picked', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('checkbox', { name: 'Select Internet' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 2 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
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
  await row(page, 'Cloud storage').click();

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

  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('checkbox', { name: 'Select Gym' }).click();
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: /^Pay 2 selected/ }).click();

  const sheet = page.getByRole('dialog', { name: 'Pay several' });
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
