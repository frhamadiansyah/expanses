import { expect, test } from '@playwright/test';
import { openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardSection } from './card-section';
import { screenshotFiles, setStatementImages, statementLines, summaryLines } from './statement';

/*
 * Today is pinned to 15 September 2026 and the card bills on the 10th, so the statement one back from today is
 * 11 August – 10 September 2026: closed, and the one checked here.
 */
const TODAY = new Date('2026-09-15T12:00:00');

test('a statement travels from screenshots to a reconciled month', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openCard(page, { name: 'BCA Visa', statementDay: '10', dueDay: '25' });

  // Two purchases recorded by hand: one as the statement prints it, one Rp 500 short of it.
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Kopi Senja', paidWith: 'BCA Visa', category: 'Cafe & dessert', amount: '85000', date: '2026-08-15' });
  await addTransaction(page, { description: 'Toko Buku', paidWith: 'BCA Visa', category: 'Books', amount: '126000', date: '2026-08-18' });

  await page.goto('/cards');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardSection(page, 'Activity');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-range')).toContainText('11 Aug');
  await page.getByTestId('check-statement').click();
  await expect(page.getByRole('heading', { name: 'Check statement' })).toBeVisible();

  // Two pages of rows and the summary. The 85,000 is on the first and the 126,500 on the second.
  await setStatementImages(page, [
    statementLines([
      ['15AUG', 'KOPI SENJA JAKARTA ID', '85,000'],
      ['18AUG', 'TOKO BUKU JAKARTA ID', '126,500'],
      ['20AUG', 'WARUNG SATE PAK DIN', '45,000'],
    ]),
    statementLines([
      ['25AUG', 'WARUNG SATE PAK DIN', '60,000'],
      ['01SEP', 'STAMP DUTY FEE', '10,000'],
      ['05SEP', 'PAYMENT - THANK YOU', '100,000CR'],
    ]),
    summaryLines([['New Balance', '226,500']]),
  ]);
  await page.getByTestId('statement-files').setInputFiles(screenshotFiles(3));
  await expect(page.getByTestId('statement-shot')).toHaveCount(3);
  await page.getByRole('button', { name: 'Check 3 screenshots' }).click();

  await expect(page.getByRole('heading', { name: 'August 2026 statement' })).toBeVisible();
  await expect(page.getByTestId('count-matched')).toHaveText(/^Matched1›?$/);
  await expect(page.getByTestId('count-differs')).toHaveText(/^Amount differs1›?$/);
  await expect(page.getByTestId('count-missing')).toHaveText(/^Missing — record here3›?$/);
  await expect(page.getByTestId('count-payments')).toHaveText(/^Payments not tracked.*−Rp\s100\.0001›?$/);
  await expect(page.getByTestId('count-flagged')).toHaveText(/not on this statement0›?$/);

  // A credit can be called a refund instead, and back: it moves between the payments line and the missing rows.
  await page.getByTestId('count-payments').click();
  const payment = page.getByTestId('payment-row');
  await expect(payment).toContainText('PAYMENT - THANK YOU');
  await expect(payment.getByRole('radio', { name: 'Card payment' })).toHaveAttribute('aria-checked', 'true');
  await payment.getByRole('radio', { name: 'Refund' }).click();
  await expect(payment).toHaveCount(0);
  await page.getByRole('button', { name: 'August statement' }).click();
  await expect(page.getByTestId('count-missing')).toHaveText(/^Missing — record here4›?$/);
  await expect(page.getByTestId('count-payments')).toHaveCount(0);
  await page.getByTestId('count-missing').click();
  await page.getByTestId('missing-row').filter({ hasText: 'PAYMENT - THANK YOU' }).getByRole('radio', { name: 'Card payment' }).click();
  await expect(page.getByTestId('missing-row')).toHaveCount(3);
  await page.getByRole('button', { name: 'August statement' }).click();
  await expect(page.getByTestId('count-payments')).toHaveText(/^Payments not tracked.*−Rp\s100\.0001›?$/);

  // The near amount takes the statement's figure.
  await page.getByTestId('count-differs').click();
  await page.getByTestId('differs-row').getByRole('button', { name: /^Use .*126\.500/ }).click();
  await expect(page.getByTestId('differs-row').getByRole('button', { name: /^Use .*126\.500/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'August statement' }).click();

  // The missing rows: the fee comes filed, the unknown merchant asks once and its twin follows.
  await page.getByTestId('count-missing').click();
  const missing = page.getByTestId('missing-row');
  await expect(missing).toHaveCount(3);
  await expect(missing.filter({ hasText: 'STAMP DUTY FEE' })).toContainText('Fees & charges');
  await expect(page.getByTestId('record-all')).toContainText('Record all 3 · 2 still need a category');
  await missing.filter({ hasText: '45.000' }).getByRole('button', { name: /Choose category/ }).click();
  await page.getByRole('dialog', { name: 'WARUNG SATE PAK DIN' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await expect(missing.filter({ hasText: '60.000' })).toContainText('same merchant');
  await expect(missing.filter({ hasText: '60.000' })).toContainText('Restaurants');
  await page.getByTestId('record-all').click();

  // Back on the card, the check says how it came out, and the statement carries it.
  await expect(page.getByRole('status').filter({ hasText: 'August statement checked — ✓ Reconciled' })).toBeVisible();
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('check-statement')).toContainText('Checked · ✓ Reconciled');

  // Cashflow for the year, filtered to the card: the categories the card's money went to, and nothing else.
  await page.goto('/transactions');
  const chart = page.getByTestId('spending-report');
  await chart.getByTestId('chart-month').click();
  const periods = page.getByTestId('period-picker');
  await periods.getByRole('tab', { name: 'Year' }).click();
  await periods.getByRole('button', { name: '2026', exact: true }).click();
  await expect(chart.getByTestId('chart-month')).toContainText('2026');
  await page.getByRole('button', { name: 'Paid with:' }).click();
  await page.getByRole('option', { name: 'BCA Visa' }).click();
  // 85.000 + 126.500 + 45.000 + 60.000 + 10.000: the card's spending, the payments line not among it.
  await expect(chart.getByTestId('period-total')).toContainText('326.500');
  await chart.getByTestId('see-categories').click();
  const rows = chart.getByTestId('report-row');
  await expect(rows.filter({ hasText: 'Food and beverage' })).toContainText('190.000');
  await expect(rows.filter({ hasText: 'Shopping' })).toContainText('126.500');
  await expect(rows.filter({ hasText: 'Miscellaneous' })).toContainText('10.000');
  await expect(rows).toHaveCount(3);

  // The quiet adjustment lives on the card's statement only, never in the transaction history.
  // The card's purchases are listed first, so the absences below are read off a filled history, not an empty one.
  const history = page.getByTestId('transaction-row');
  await expect(history.first()).toBeVisible();
  await expect(history.filter({ hasText: /Payments not tracked/ })).toHaveCount(0);
  await expect(history.filter({ hasText: /PAYMENT - THANK YOU|Card payment/ })).toHaveCount(0);
});
