import { expect, test } from '@playwright/test';
import { addPlastic, expectWalletFigure, openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage } from './card-section';
import { screenshotFiles, setStatementImages, statementLines, summaryLines, twoDateLines } from './statement';

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

  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
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
  await expect(page.getByTestId('check-statement')).toHaveAttribute('aria-label', /^Check statement, checked \d+ \w+, reconciled$/);
  await expect(page.getByTestId('check-statement-dot')).toBeVisible();

  // Cashflow for the year, filtered to the card: the categories the card's money went to, and nothing else.
  await page.goto('/transactions');
  const chart = page.getByTestId('spending-report');
  await chart.getByTestId('chart-month').click();
  const periods = page.getByTestId('period-picker');
  await periods.getByRole('tab', { name: 'Year' }).click();
  await periods.getByRole('button', { name: '2026', exact: true }).click();
  await expect(chart.getByTestId('chart-month')).toContainText('2026');
  // The filter is a sheet on a phone: the card's row, led by its digits, is named with both.
  await page.getByRole('button', { name: 'Sort and filter' }).click();
  await page.getByRole('menuitem', { name: /^Paid with/ }).click();
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: /^BCA Visa/ }).click();
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

test('a foreign purchase missing from cicis shows the amount in its own currency under the charge', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openCard(page, { name: 'BCA Visa', statementDay: '10', dueDay: '25' });
  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await page.getByTestId('check-statement').click();

  await setStatementImages(page, [
    twoDateLines([
      ['15-Aug-26', '17-Aug-26', 'KAFE ORNEK CITY TR', '140,492.00', '(TRY 412.00 x 341.00)'],
      ['18-Aug-26', '19-Aug-26', 'TOKO ORNEK KOTA ORNEK ID', '50,000.00'],
    ]),
  ]);
  await page.getByTestId('statement-files').setInputFiles(screenshotFiles(1));
  await page.getByRole('button', { name: 'Check 1 screenshot' }).click();
  await expect(page.getByTestId('count-missing')).toHaveText(/^Missing — record here2›?$/);
  await page.getByTestId('count-missing').click();
  const missing = page.getByTestId('missing-row');
  await expect(missing.filter({ hasText: 'KAFE ORNEK CITY TR' }).getByTestId('missing-original')).toHaveText(/^TRY\s412,00$/);
  await expect(missing.filter({ hasText: 'TOKO ORNEK KOTA ORNEK ID' }).getByTestId('missing-original')).toHaveCount(0);
});

test('a statement older than the card’s start records as already paid off, with no summary screenshot', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  // The card starts in the app today, owing what it owes: August is before that.
  await openCard(page, { name: 'BCA Visa', statementDay: '10', dueDay: '25', owed: '2000000' });

  await page.goto('/wallet');
  await page.getByRole('link', { name: 'BCA Visa' }).click();
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await page.getByTestId('check-statement').click();
  await setStatementImages(page, [statementLines([['20AUG', 'WARUNG SATE PAK DIN', '45,000']])]);
  await page.getByTestId('statement-files').setInputFiles(screenshotFiles(1));
  await page.getByRole('button', { name: 'Check 1 screenshot' }).click();

  // Without the summary it cannot move the card's start; paid off, it needs nothing more.
  await expect(page.getByTestId('needs-previous')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Already paid off' }).click();
  await expect(page.getByTestId('needs-previous')).toHaveCount(0);
  await page.getByTestId('count-missing').click();
  await page.getByTestId('missing-row').getByRole('button', { name: /Choose category/ }).click();
  await page.getByRole('dialog', { name: 'WARUNG SATE PAK DIN' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await page.getByTestId('record-all').click();
  await expect(page.getByRole('status').filter({ hasText: 'August statement recorded — already paid off' })).toBeVisible();

  // Spending in August; the card still owes what it owed.
  await page.goto('/transactions?month=2026-08');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'WARUNG SATE PAK DIN' })).toContainText('45.000');
  await page.goto('/wallet');
  // The card's figure is in its face's name: the wallet's cards carry no caption of their own any more.
  await expectWalletFigure(page, 'BCA Visa', '2.000.000');
});

test('a card row filed under Top-ups records as the top-up it was: what landed in the wallet, and the fee beside it', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openCard(page, { name: 'BCA Visa', statementDay: '10', dueDay: '25', last4: '4821' });
  await openAccount(page, { subtype: 'ewallet', name: 'GoPay' });

  await page.goto('/wallet');
  await page.getByRole('link', { name: /^BCA Visa/ }).first().click();
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await page.getByTestId('check-statement').click();
  await setStatementImages(page, [statementLines([['22AUG', 'WALLET RELOAD 7731', '1,010,000']]), summaryLines([['New Balance', '1,010,000']])]);
  await page.getByTestId('statement-files').setInputFiles(screenshotFiles(2));
  await page.getByRole('button', { name: 'Check 2 screenshots' }).click();
  await page.getByTestId('count-missing').click();

  // Top-ups sits under Miscellaneous like any other category; picked on a card row, it asks where the money went.
  await page.getByTestId('missing-row').getByRole('button', { name: /Choose category/ }).click();
  await page.getByRole('dialog', { name: 'WALLET RELOAD 7731' }).getByRole('button', { name: 'Top-ups', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Top-up' });
  await expect(sheet).toContainText(/Rp\s1\.010\.000 charged to BCA Visa 4821/);
  await sheet.getByLabel('Into').selectOption({ label: 'GoPay' });
  await sheet.getByLabel('Fee', { exact: true }).fill('10000');
  const summary = sheet.getByTestId('top-up-summary');
  await expect(summary).toContainText(/Lands in GoPay\s*Rp\s1\.000\.000/);
  await expect(summary).toContainText(/Fee · Fees & charges\s*Rp\s10\.000/);
  await expect(summary).toContainText(/Card charged · Top-ups\s*Rp\s1\.010\.000/);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toHaveCount(0);

  // The row reads as the transfer it will be, and still stands for the statement's whole 1.010.000.
  const row = page.getByTestId('missing-row');
  await expect(row).toContainText('Top-up');
  await expect(row.getByTestId('top-up-sides')).toHaveText('BCA Visa 4821 → GoPay');
  await expect(row).toContainText('1.000.000');
  await expect(row.getByTestId('amount-extra')).toHaveText(/^\+ Rp\s10\.000$/);
  await expect(page.getByTestId('record-all')).toHaveText('Record all 1');
  await page.getByTestId('record-all').click();
  await expect(page.getByRole('status').filter({ hasText: 'August statement checked — ✓ Reconciled' })).toBeVisible();

  // Cashflow shows one top-up: the card's digits, the wallet, what landed, and the fee under it.
  await page.goto('/transactions?month=2026-08');
  const recorded = page.getByTestId('transaction-row').filter({ hasText: 'WALLET RELOAD 7731' });
  await expect(recorded).toHaveCount(1);
  await expect(recorded).toContainText('4821 → GoPay');
  await expect(recorded).toContainText('1.000.000');
  await expect(recorded.getByTestId('amount-extra')).toHaveText(/^\+ Rp\s10\.000$/);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'GoPay', '1.000.000');
});

test('the check page shows a single plastic read-only and offers a choice between two', async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
  await openCard(page, { name: 'Mandiri Bonvoy', bank: 'Mandiri', last4: '1467', statementDay: '10', dueDay: '25' });
  const open = async () => {
    await page.goto('/wallet');
    await page.getByRole('link', { name: /^Mandiri Bonvoy/ }).first().click();
    await cardPage(page, 'Statement');
    await page.getByRole('button', { name: 'Earlier statement' }).click();
    await page.getByTestId('check-statement').click();
  };

  // One plastic: its digits read, nothing to choose. The check button is a disabled action row with no screenshots.
  await open();
  await expect(page.getByText('Last 4 digits')).toBeVisible();
  await expect(page.getByText('1467')).toBeVisible();
  await expect(page.getByRole('button', { name: /Last 4 digits/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check 0 screenshots' })).toBeDisabled();

  // A second plastic: a picker, the primary chosen unless another is picked.
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Mandiri Bonvoy/ }).first().click();
  await cardPage(page, 'Settings');
  await addPlastic(page, '8802', 'Spouse');
  await expect(page.getByTestId('card-on-account')).toHaveCount(2);
  await open();
  const row = page.getByRole('button', { name: /Last 4 digits/ });
  await expect(row).toContainText('Primary ···· 1467');
  await row.click();
  await page.getByRole('dialog', { name: 'Which card' }).getByRole('button', { name: /Supplementary ···· 8802/ }).click();
  await expect(row).toContainText('Supplementary ···· 8802');
});
