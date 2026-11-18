import { expect, type Page } from '@playwright/test';
import { openCard, openLoan } from './accounts';
import { addTransaction } from './add-transaction';
import { addBill, at, bank, openPaylater, owedTo } from './debt-plan';

/*
 * The Mac Debt-free plan's invented household, on 11 Nov 2026 (every name and figure made up):
 *
 * - BCA Tahapan, Rp 50.000.000.
 * - Kredivo, a paylater opened 1 Aug (Rp 6.000.000, 2% a month, 6 months): September, October and November unpaid —
 *   three instalments late.
 * - BCA Visa (statement on the 25th, due the 8th) with Rp 6.214.300 bought on 20 Oct: the statement due 8 Nov unpaid, late.
 * - KTA Mandiri, a multi-purpose loan opened 5 Oct (Rp 24.000.000 at 10,8% over 24 months): its first instalment, 5 Nov,
 *   unpaid — one late.
 * - Car loan Adira, vehicle leasing opened 20 Oct (Rp 150.000.000 at 6,9% over 48 months): first due 20 Nov.
 * - KPR BCA, a home mortgage opened 11 Nov (Rp 450.000.000 at 4,75% over 180 months): first due 11 Dec.
 * - Rp 850.000 owed to Dewi, no due date; Electricity, Rp 780.000, out on the 10th and paid by the 20th.
 *
 * Three debts late: Kredivo, KTA Mandiri and BCA Visa.
 */
export const DESK = {
  paylater: 'Kredivo',
  kta: 'KTA Mandiri',
  car: 'Car loan Adira',
  kpr: 'KPR BCA',
  card: 'BCA Visa',
  person: 'Dewi',
};

export async function seedDesk(page: Page) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.setSystemTime(at('2026-08-01'));
  await bank(page);
  await openPaylater(page, { name: DESK.paylater, owed: '6000000', perMonth: '2', months: '6' });
  await page.clock.setSystemTime(at('2026-10-01'));
  await openCard(page, { name: DESK.card, statementDay: '25', dueDay: '8' });
  await page.clock.setSystemTime(at('2026-10-05'));
  await openLoan(page, { kind: 'Multi-purpose loan', name: DESK.kta, owed: '24000000', lender: 'Mandiri', interestRate: '10.8', months: '24' });
  await page.clock.setSystemTime(at('2026-10-20'));
  await openLoan(page, { kind: 'Vehicle leasing', name: DESK.car, owed: '150000000', lender: 'Adira', interestRate: '6.9', months: '48' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Hotel Mulia', paidWith: DESK.card, category: 'Groceries', amount: '6214300', date: '2026-10-20', keyByKey: true });
  await page.clock.setSystemTime(at('2026-11-11'));
  await openLoan(page, { kind: 'Home mortgage', name: DESK.kpr, owed: '450000000', lender: 'BCA', interestRate: '4.75', months: '180' });
  await owedTo(page, DESK.person, '850000');
  await addBill(page, { name: 'Electricity', amount: '780000', outDay: '10', payBy: '20' });
  await page.goto('/net-worth/plan');
  await expect(page.getByTestId('debt-plan-page')).toBeVisible();
}

/** The Debts table's names, in order. */
export const tableNames = (page: Page) => page.getByTestId('plan-table-row').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-name') ?? ''));
