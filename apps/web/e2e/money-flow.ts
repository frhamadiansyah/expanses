import type { Page } from '@playwright/test';
import { openAccount } from './accounts';
import { addTransaction, addTransfer } from './add-transaction';

/** A bank, a wallet and a card; then one pay, two purchases and a top-up, all this month. */
export async function recordMonth(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay' });
  await openAccount(page, { subtype: 'credit_card', name: 'BCA Visa', last4: '4321' });
  await page.goto('/transactions');
  await addTransaction(page, { mode: 'Income', description: 'October pay', paidWith: 'BCA Tahapan', category: 'Salary', amount: '12000000' });
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Tahapan', category: 'Groceries', amount: '900000' });
  await addTransaction(page, { description: 'Grab to the office', paidWith: 'BCA Visa', category: 'Transport', amount: '150000' });
  await addTransfer(page, { from: 'BCA Tahapan', to: 'GoPay', amount: '500000', note: 'Top-up' });
}
