import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, openPaidSheet, payCard } from './card-section';

/*
 * The statement without payment rows (owner, 21 Nov 2026): the list holds purchases and money back; the totals box's
 * Paid (Previous bill on the open statement) opens the payments, each to be opened, edited or deleted as from
 * Cashflow. Invented names and figures. With STATEMENT_SHOTS set to a folder, the 390px list and sheet are saved
 * there, light and dark.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const lastMonth = (day: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const line = (page: Page, what: string) => page.getByTestId('statement-line').filter({ hasText: what });

async function openStatement(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await cardPage(page, 'Statement');
}

test('payments are kept off the statement’s list, and Paid in the box opens them', async ({ page }) => {
  // Three purchases through the Add screen, a payment, two statements and a delete: a long journey.
  test.slow();
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '20000000' });
  await openCard(page, { name: 'Kartu Contoh', last4: '4417', statementDay: '31', dueDay: '15' });
  await page.goto('/transactions');
  const buy = (description: string, amount: string, date?: string) => addTransaction(page, { description, paidWith: 'Kartu Contoh', category: 'Groceries', amount, ...(date ? { date, paidOff: false } : {}) });
  await buy('Restoran Contoh', '640000', lastMonth(4));
  await buy('Toko Buku Contoh', '360000', lastMonth(9));
  await buy('Apotek Contoh', '150000');
  // A lump payment today: on today's statement, and it pays last month's bill down.
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await payCard(page, { from: 'Bank Contoh', amount: '700000' });

  // Today's statement: the purchase only; Previous bill opens the payment, which pays it first.
  await openStatement(page);
  await expect(page.getByTestId('statement-line')).toHaveCount(1);
  await expect(line(page, 'Apotek Contoh')).toBeVisible();
  let sheet = await openPaidSheet(page);
  await expect(sheet).toHaveAccessibleName(/^Paid · Rp\s700\.000$/);
  await expect(sheet.getByTestId('statement-paid-entry')).toHaveCount(1);
  await expect(sheet.getByTestId('statement-paid-entry')).toContainText(/\d+ \w+ · from Bank Contoh/);
  await expect(sheet.getByTestId('statement-paid-entry')).toContainText('700.000');
  await expect(sheet).toContainText('Payments stay in Cashflow and on Bank Contoh as transfers.');
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);

  // Last month's: its two purchases, and its Paid opens the same payment, as far as its bill needed it.
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-line')).toHaveCount(2);
  await expect(page.getByTestId('statement-band')).toContainText(/Paid\s*Rp\s700\.000/);
  await expect(page.getByTestId('statement-group')).toContainText(/1 of 2 paid/i);

  const shots = process.env.STATEMENT_SHOTS;
  for (const scheme of shots ? (['light', 'dark'] as const) : []) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: `${shots}/statement-payments-list-${scheme}.png` });
    const open = await openPaidSheet(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shots}/statement-payments-sheet-${scheme}.png` });
    await open.getByRole('button', { name: 'Close' }).click();
    await expect(open).toHaveCount(0);
  }
  await page.emulateMedia({ colorScheme: 'light' });

  sheet = await openPaidSheet(page);
  await expect(sheet).toHaveAccessibleName(/^Paid · Rp\s700\.000$/);
  const entry = sheet.getByTestId('statement-paid-entry');
  await expect(entry).toHaveCount(1);

  // A tap opens the payment as Cashflow does: Edit and Delete are there.
  await entry.click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);

  // Deleted, nothing is paid: Paid stays plain, with nothing to open.
  await openStatement(page);
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-band')).toContainText(/Paid\s*Rp\s0/);
  await expect(page.getByTestId('statement-paid-open')).toHaveCount(0);
});
