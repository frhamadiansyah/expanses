import { expect, type Page, test } from '@playwright/test';
import { openAccount } from './accounts';

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
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'BCA Tahapan' });
  await page.getByLabel('Bill is out on').selectOption(String(options.out ?? 1));
  if (options.payBy !== undefined) await page.getByLabel('Pay by').selectOption(String(options.payBy));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bill-row').filter({ hasText: options.name })).toBeVisible();
}

const row = (page: Page, name: string) => page.getByTestId('bill-row').filter({ hasText: name });

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
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByRole('heading', { name: 'Edit bill' })).toBeVisible();
  await expect(page.getByLabel('Bill is out on')).toHaveValue('28');
  await expect(page.getByLabel('Pay by')).toHaveValue('5');
  await page.getByLabel('Pay by').selectOption('');
  await page.getByRole('button', { name: 'Save' }).click();
  // Save on an edit returns to the bill's own page, not the list — Edit bill is reached from there directly.
  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByLabel('Pay by')).toHaveValue('');
});

test('a bill’s page pays its month and stays, with the payment and an undo', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Biznet Home', amount: '450000', out: 1, payBy: 28 });
  await row(page, 'Biznet Home').click();

  await expect(page.getByRole('heading', { name: 'Biznet Home' })).toBeVisible();
  await expect(page.getByText('Every month · out on the 1st · pay by the 28th')).toBeVisible();
  await page.getByRole('button', { name: /^Pay \w+ bill$/ }).click();
  await page.getByRole('dialog', { name: 'Pay Biznet Home' }).getByRole('button', { name: 'Record payment' }).click();

  await expect(page.getByRole('dialog', { name: 'Pay Biznet Home' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/bills\/[^/]+$/);
  const banner = page.getByTestId('just-paid');
  await expect(banner).toContainText(/✓ Paid .*450\.000 on/);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText('450.000');
  await expect(page.getByRole('button', { name: /^Pay \w+ bill$/ })).toHaveCount(0);

  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pay \w+ bill$/ })).toBeVisible();
});

test('from a bill’s page: skip its month, edit it, and stop it', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Gym', amount: '350000' });
  await row(page, 'Gym').click();
  await expect(page.getByText('Paid from')).toBeVisible();

  await page.getByRole('button', { name: /^Skip \w+ bill$/ }).click();
  await expect(page.getByTestId('bill-hero')).toContainText('Skipped');

  await page.getByRole('link', { name: 'Edit bill' }).click();
  await page.getByLabel('Pay by').selectOption('5');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Every month · out on the 1st · pay by the 5th')).toBeVisible();

  await page.getByRole('button', { name: 'Stop this bill' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(row(page, 'Gym')).toHaveCount(0);
});

test('a skipped row’s ⋯ menu still opens the bill’s page', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Netflix', amount: '120000' });
  await rowAction(page, 'Netflix', /^Skip/);
  await expect(row(page, 'Netflix')).toContainText('Skipped');
  await rowAction(page, 'Netflix', /^See bill$/);
  await expect(page.getByRole('heading', { name: 'Netflix' })).toBeVisible();
});

test('a bill that is out is paid from its row, and the month is settled', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });

  await page.goto('/transactions');
  await page.getByTestId('recurring-card').click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByTestId('bills-summary')).toContainText('Still to pay in');
  await expect(page.getByTestId('bills-summary')).toContainText('150.000');

  await rowAction(page, 'Phone', /^Pay/);
  const sheet = page.getByRole('dialog', { name: 'Pay Phone' });
  await expect(sheet.getByLabel('What it came to')).not.toHaveValue('');
  await sheet.getByRole('button', { name: 'Record payment' }).click();

  await expect(sheet).toHaveCount(0);
  await expect(toast(page)).toContainText('Paid Phone');
  await expect(page.getByText('Paid and skipped · 1')).toBeVisible();
  await expect(row(page, 'Phone')).toContainText('✓ Paid');

  await page.goto('/transactions');
  await expect(page.getByTestId('recurring-card')).toContainText('1 of 1 bill paid');
  await expect(page.getByRole('listitem').filter({ hasText: 'Phone' }).first()).toBeVisible();
});

test('undo takes a payment back', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await rowAction(page, 'Phone', /^Pay/);
  await page.getByRole('dialog', { name: 'Pay Phone' }).getByRole('button', { name: 'Record payment' }).click();
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByText(/Paid and skipped/)).toHaveCount(0);
  await expect(row(page, 'Phone')).not.toContainText('✓ Paid');
});

test('a bill that varies asks what it came to', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Electricity' });
  await expect(row(page, 'Electricity')).toContainText('Amount varies');

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
  await expect(row(page, 'Fitness First')).toContainText('Skipped');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Fitness First')).not.toContainText('Skipped');
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
  await page.getByRole('button', { name: /^Pay 2 selected/ }).click();

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

test('unticking a bill in Pay several leaves it unpaid', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('button', { name: /^Pay 1 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  // The rest of the month's unpaid bills are offered, unticked.
  await expect(sheet.getByRole('checkbox', { name: 'Pay Internet' })).not.toBeChecked();
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();
  await expect(row(page, 'Internet')).not.toContainText('✓ Paid');
  await expect(row(page, 'Phone')).toContainText('✓ Paid');
});

test('a bill not out yet opens later, and can be paid early', async ({ page }) => {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  test.skip(now.getDate() >= last, 'Nothing is still to come on the last day of a month');
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Housing rent', amount: '5000000', out: 31 });
  await expect(page.getByText('Later', { exact: true })).toBeVisible();
  await expect(row(page, 'Housing rent')).toContainText('Opens');
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
  await expect(row(page, 'Biznet Home')).toContainText('Overdue');
  await row(page, 'Biznet Home').click();
  await page.getByRole('button', { name: `Pay ${lastMonth} bill` }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay Biznet Home' });
  await expect(sheet.getByLabel('For')).toHaveValue(new RegExp(`-${String(earlier.getMonth() + 1).padStart(2, '0')}$`));
  await sheet.getByRole('button', { name: 'Record payment' }).click();

  // The page moves on to this month's bill; the confirmation stays with the one just paid.
  const banner = page.getByTestId('just-paid');
  await expect(banner).toContainText(/✓ Paid .*450\.000 on/);
  await expect(banner).toContainText(`${lastMonth} bill`);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText(`${lastMonth} bill`);
  await expect(page.getByTestId('bill-history').locator('[data-new="true"]')).toContainText('450.000');
  await expect(page.getByRole('button', { name: `Pay ${thisMonth} bill` })).toBeVisible();

  await banner.getByRole('button', { name: 'Undo' }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Pay ${lastMonth} bill` })).toBeVisible();

  await page.getByRole('button', { name: `Pay ${lastMonth} bill` }).click();
  await sheet.getByRole('button', { name: 'Record payment' }).click();
  await expect(banner).toContainText(`${lastMonth} bill`);

  // Listed on the day it was paid, with a tag saying whose month it was.
  await page.goto('/transactions');
  await expect(page.getByRole('listitem').filter({ hasText: 'Biznet Home' }).first()).toContainText(`${lastMonth.slice(0, 3)} bill`);
  // The table says the same on a wide screen.
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByTestId('table-row').filter({ hasText: `${lastMonth.slice(0, 3)} bill` })).toHaveCount(1);
});

test('Pay several names the bill it recorded, not the one first picked', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await addBill(page, { name: 'Phone', amount: '150000' });
  await addBill(page, { name: 'Internet', amount: '395000' });
  await page.getByRole('button', { name: 'Select bills to pay' }).click();
  await page.getByRole('checkbox', { name: 'Select Phone' }).click();
  await page.getByRole('checkbox', { name: 'Select Internet' }).click();
  await page.getByRole('button', { name: /^Pay 2 selected/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Pay several' });
  await sheet.getByRole('checkbox', { name: 'Pay Phone' }).click();
  await sheet.getByRole('button', { name: 'Record 1 bill' }).click();

  await expect(toast(page)).toContainText('Paid Internet');
  await expect(row(page, 'Internet')).toContainText('✓ Paid');
  await toast(page).getByRole('button', { name: 'Undo' }).click();
  await expect(row(page, 'Internet')).not.toContainText('✓ Paid');
  await expect(row(page, 'Phone')).not.toContainText('✓ Paid');
});

test('a bill paid from a dollar account keeps its amount through an edit', async ({ page }) => {
  await addWallet(page, 'BCA Tahapan');
  await openAccount(page, { subtype: 'bank', name: 'Wise USD', currency: 'USD' });

  await page.goto('/bills/new');
  await page.getByLabel('Name', { exact: true }).fill('Cloud storage');
  await page.getByLabel('Amount', { exact: true }).fill('15');
  await page.getByLabel('Category').selectOption({ index: 1 });
  await page.getByLabel('Paid from').selectOption({ label: 'Wise USD' });
  await page.getByRole('button', { name: 'Save' }).click();
  await row(page, 'Cloud storage').click();

  await page.getByRole('link', { name: 'Edit bill' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('15.00');
  await page.getByRole('button', { name: 'Save' }).click();
  // Formatted the Indonesian way, "US$15,00"; the bug read it as rupiah and saved "US$1.500,00".
  await expect(page.getByTestId('bill-hero')).toContainText(/US\$\s?15,00/);
});
