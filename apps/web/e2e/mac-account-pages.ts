import { expect, type Page } from '@playwright/test';
import { addPlastic, openAccount, openCard, openFace, walletCard } from './accounts';
import { addTransaction, addTransfer } from './add-transaction';
import { cardPage, saveCardTerms } from './card-section';

/*
 * The Mac account pages (owner 2026-11-20) walked on invented data: a saving account with a month of rows, and a credit
 * card with a supplementary card, a statement cut at the end of last month and purchases on both statements.
 */

const pad = (n: number) => String(n).padStart(2, '0');
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
export const TODAY = local(now);
/** The 1st of last month: the day the saving account is opened, so this month's box has no opening in it. */
export const OPENED = local(new Date(now.getFullYear(), now.getMonth() - 1, 1));
/** On last month's statement (cut on the month's last day). */
export const LAST_EARLY = local(new Date(now.getFullYear(), now.getMonth() - 1, 9));
export const LAST_LATE = local(new Date(now.getFullYear(), now.getMonth() - 1, 16));
/** On this month's statement, never after today. */
export const THIS_FIRST = local(new Date(now.getFullYear(), now.getMonth(), 1));

/**
 * A saving account opened last month at Rp 25.000.000 and GoPay at Rp 100.000; this month the salary comes in, a
 * shop is paid and GoPay topped up. Today's balance: 25.000.000 + 21.400.000 − 38.500 − 900.000 = 45.461.500.
 */
export async function bankMonth(page: Page) {
  await openAccount(page, { subtype: 'savings', name: 'Tahapan Kita', balance: '25000000', opened: OPENED });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay', balance: '100000' });
  await page.goto('/transactions');
  await addTransaction(page, { mode: 'Income', description: 'Gaji Sinar Kreatif', paidWith: 'Tahapan Kita', category: 'Salary, wage, or pay', amount: '21400000', date: THIS_FIRST });
  await addTransaction(page, { description: 'Alfamart Senopati', paidWith: 'Tahapan Kita', category: 'Groceries', amount: '38500', date: TODAY });
  await addTransfer(page, { from: 'Tahapan Kita', to: 'GoPay', amount: '900000', note: 'GoPay top-up' });
}

/** The account's own page from its face on Mac Wallet (a double-click). */
export async function openBankPage(page: Page) {
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Tahapan Kita'));
  await expect(page.getByTestId('account-desk')).toBeVisible();
}

/**
 * A credit card cut on the last day of the month, due on the 15th, with a supplementary card (8802) beside the
 * primary (4417): last month Rp 1.250.000 and Rp 312.000, this month Rp 86.000 and Rp 145.500. Owed: 1.793.500.
 */
export async function cardStatements(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'Tahapan Kita', balance: '20000000' });
  await openCard(page, { name: 'Visa Kita', last4: '4417' });
  await openCardPage(page);
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('31');
  await page.getByLabel('Due date').fill('15');
  await saveCardTerms(page);
  await addPlastic(page, '8802', 'Rina');
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Hotel Santika', paidWith: 'Visa Kita ···· 4417', category: 'Groceries', amount: '1250000', date: LAST_EARLY });
  await addTransaction(page, { description: 'Superindo', paidWith: 'Visa Kita ···· 8802', category: 'Groceries', amount: '312000', date: LAST_LATE });
  await addTransaction(page, { description: 'Kopi Tuku', paidWith: 'Visa Kita ···· 4417', category: 'Cafe & dessert', amount: '86000', date: THIS_FIRST });
  await addTransaction(page, { description: 'Bluebird', paidWith: 'Visa Kita ···· 4417', category: 'Ride hailing', amount: '145500', date: TODAY });
}

/** The card's own page from its face on Mac Wallet. */
export async function openCardPage(page: Page) {
  await page.goto('/wallet');
  await openFace(walletCard(page, 'Visa Kita'));
  await expect(page.getByRole('heading', { name: 'Visa Kita', exact: true })).toBeVisible();
}
