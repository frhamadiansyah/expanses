import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard, openLoan } from './accounts';
import { addTransaction } from './add-transaction';
import { addPriced } from './asset-page';
import { receiptPeek } from './receipt-peek';
import { doubleClickInPlace } from './desk-double-click';
import { macV2 } from './mac-detail';

/*
 * Net worth on a wide screen (Mac redesign step 8): the figure and its months beside Financial health, then Assets and
 * Debts (with Investments under it), each a treemap strip of its kinds over a table of kinds and rows. A click opens a
 * row's side peek, a double-click its page; Prices, Trade and ＋ Add sit in the title bar. Invented figures.
 */

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

const peek = (page: Page) => page.getByTestId('networth-peek');
/** The digits of a figure, as a number: "Rp 1.234.000" → 1234000. */
const amount = async (page: Page, testId: string) => Number((await page.getByTestId(testId).innerText()).replace(/[^\d-]/g, ''));
const row = (page: Page, name: string) => page.locator('[data-testid^="sheet-row-"]').filter({ hasText: name });

test('the figure is Total assets − Total debts, each kind is its rows added up, and the treemaps’ shares add up to 100', async ({ page }) => {
  // The treemaps, the cards note and Financial health are v2 parts of Mac Net worth.
  await macV2(page);
  await openAccount(page, { subtype: 'bank', name: 'Bank Seroja', balance: '84500000' });
  await openAccount(page, { subtype: 'savings', name: 'Bank Kenanga', balance: '15500000' });
  await openCard(page, { name: 'Kartu Teratai', owed: '6250000', last4: '4242' });
  await openLoan(page, { kind: 'Home mortgage', name: 'KPR Cibubur', owed: '342000000', lender: 'Bank Seroja', interestRate: '7.25', months: '168' });
  await addPriced(page, 'Gold bullion', 'Emas batangan', [['2025-09-19', '20', '38600000']]);

  await page.goto('/net-worth');
  await expect(page.getByRole('heading', { name: 'Net worth', level: 1 })).toBeVisible();
  // 84.500.000 + 15.500.000 + 38.600.000 owned; the card's 6.250.000 in full and the mortgage's 342.000.000 owed.
  await expect(page.getByTestId('sheet-total-assets')).toHaveText('Rp 138.600.000');
  await expect(page.getByTestId('sheet-total-liabilities')).toHaveText('Rp 348.250.000');
  await expect(page.getByTestId('net-worth-figure')).toHaveText('-Rp 209.650.000');
  expect((await amount(page, 'sheet-total-assets')) - (await amount(page, 'sheet-total-liabilities'))).toBe(await amount(page, 'net-worth-figure'));

  // A kind's figure is its rows: Cash & equivalents is the two banks.
  await expect(page.getByTestId('kind-total-liquid')).toHaveText('Rp 100.000.000');
  await expect(row(page, 'Bank Seroja')).toContainText('Rp 84.500.000');
  await expect(row(page, 'Bank Kenanga')).toContainText('Rp 15.500.000');
  // The debts by what they are, the card counted in full, and the note saying so.
  await expect(page.getByTestId('type-drawer-debts:home_mortgage')).toContainText('Rp 342.000.000');
  await expect(page.getByTestId('type-drawer-debts:credit_card')).toContainText('Rp 6.250.000');
  await expect(page.getByTestId('debts-card-note')).toHaveText('Cards count everything owed here, instalments included (Wallet shows only what is due now).');

  // Each treemap's boxes say their share; the shares add up to 100, as the Share column reads.
  for (const side of ['asset', 'debt']) {
    const labels = await page
      .getByTestId(`${side}-treemap`)
      .getByRole('button')
      .evaluateAll((boxes) => boxes.map((box) => box.getAttribute('aria-label') ?? ''));
    expect(labels.length).toBeGreaterThan(1);
    expect(labels.reduce((sum, label) => sum + Number(/(\d+)%$/.exec(label)![1]), 0)).toBe(100);
  }
  await expect(page.getByTestId('type-drawer-section-liquid')).toContainText('72%');
  await expect(page.getByTestId('type-drawer-section-other')).toContainText('28%');

  // ▼ folds a kind away and back; its total stays.
  await page.getByRole('button', { name: 'Fold Cash & equivalents' }).click();
  await expect(row(page, 'Bank Seroja')).toHaveCount(0);
  await expect(page.getByTestId('kind-total-liquid')).toHaveText('Rp 100.000.000');
  await page.getByRole('button', { name: 'Unfold Cash & equivalents' }).click();
  await expect(row(page, 'Bank Seroja')).toBeVisible();

  // The Financial health box opens the health screen.
  await expect(page.getByTestId('health-box')).toContainText('Emergency fund');
  await page.getByTestId('health-box').getByRole('link', { name: 'All ratios' }).click();
  await expect(page).toHaveURL(/\/net-worth\/health$/);
});

test('a click opens a row’s side peek, ⌃ ⌄ step, Esc closes; a box opens its kind; a double-click opens the page; a recent row opens the Mac receipt', async ({ page }) => {
  // A treemap box opening its kind is a v2 part of Mac Net worth.
  await macV2(page);
  await openAccount(page, { subtype: 'bank', name: 'Bank Seroja', balance: '5000000' });
  await openAccount(page, { subtype: 'cash', name: 'Dompet', balance: '250000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Sate', paidWith: 'Bank Seroja', category: 'Groceries', amount: '45000' });

  await page.goto('/net-worth');
  await row(page, 'Bank Seroja').click();
  await expect(page).toHaveURL(/\/net-worth$/);
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Bank Seroja');
  // The peek's figure is the row's.
  await expect(peek(page).getByTestId('peek-figure')).toHaveText('Rp 4.955.000');
  await expect(row(page, 'Bank Seroja')).toContainText('Rp 4.955.000');
  await expect(row(page, 'Bank Seroja')).toHaveAttribute('aria-selected', 'true');
  await expect(peek(page).getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(peek(page).getByTestId('peek-recent-row')).toContainText('Warung Sate');

  // The page makes room: the peek covers no figure.
  await expect.poll(async () => (await page.getByTestId('sheet-total-assets').boundingBox())!.x + (await page.getByTestId('sheet-total-assets').boundingBox())!.width).toBeLessThan((await peek(page).boundingBox())!.x);

  // A recent row opens the Mac receipt in the peek's place, never the receipt page.
  await peek(page).getByTestId('peek-recent-row').click();
  await expect(receiptPeek(page).getByTestId('peek-title')).toBeVisible();
  await expect(page).toHaveURL(/\/net-worth$/);
  await page.keyboard.press('Escape');
  await expect(receiptPeek(page)).toHaveCount(0);

  // ⌄ steps to the next row, ↑ back; Esc closes.
  await peek(page).getByRole('button', { name: 'Next row' }).click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Dompet');
  await page.keyboard.press('ArrowUp');
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Bank Seroja');
  await page.keyboard.press('Escape');
  await expect(peek(page)).toHaveCount(0);

  // A treemap box opens its kind: its figure, its share, its rows (each opening its own peek).
  await page.getByTestId('treemap-box-liquid').click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Cash & equivalents');
  await expect(peek(page).getByTestId('peek-figure')).toHaveText('Rp 5.205.000');
  await expect(peek(page).getByTestId('peek-line')).toContainText('100% of assets');
  await peek(page).getByTestId('peek-items').getByRole('button', { name: /Dompet/ }).click();
  await expect(peek(page).getByTestId('peek-title')).toHaveText('Dompet');
  await page.keyboard.press('Escape');

  // A double-click opens a box's kind page and a row's own page, though the peek the first click opens moves them from
  // under the pointer (a 1280 window making room for it).
  expect((await doubleClickInPlace(page, page.getByTestId('treemap-box-liquid'))).moved).toBe(true);
  await expect(page).toHaveURL(/\/net-worth\/assets$/);
  await page.goto('/net-worth');
  const dompet = await row(page, 'Dompet').getByRole('link').getAttribute('href');
  expect((await doubleClickInPlace(page, row(page, 'Dompet').getByRole('link'))).moved).toBe(true);
  await expect(page).toHaveURL(new RegExp(`${dompet}$`));
});

test('Prices, Trade and ＋ Add asset open their screens; Trade waits for something to trade', async ({ page }) => {
  // Reads the Investments box (absent here), a v2 part of Mac Net worth.
  await macV2(page);
  await openAccount(page, { subtype: 'bank', name: 'Bank Seroja', balance: '50000000' });
  await page.goto('/net-worth');
  await expect(page.getByRole('button', { name: 'Trade', exact: true })).toBeDisabled();

  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Debt…' }).click();
  await expect(page).toHaveURL(/\/debts\/new$/);
  await page.goto('/net-worth');
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Asset…' }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/new$/);

  await addPriced(page, 'Gold bullion', 'Emas batangan', [['2025-09-19', '10', '19300000']]);
  await page.goto('/net-worth');
  await page.getByRole('link', { name: 'Prices', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/prices$/);
  await expect(page.getByLabel(/Emas batangan/)).toBeVisible();

  await page.goto('/net-worth');
  // The Investments box is the Investments kind's own figure; gold is not an investment here, so none yet.
  await expect(page.getByTestId('investments-box')).toHaveCount(0);
  await page.getByRole('link', { name: 'Trade', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/new\?mode=trade$/);
  await expect(page.getByRole('form', { name: 'Trade' })).toBeVisible();
});

test('the Investments box is the Investments kind: its value as the table reads it, and the way to holdings, trades and dividends', async ({ page }) => {
  // The Investments box is a v2 part of Mac Net worth.
  await macV2(page);
  await openAccount(page, { subtype: 'bank', name: 'Bank Seroja', balance: '50000000' });
  await addPriced(page, 'Government bonds', 'ORI026', [['2026-01-15', '15000000', '15000000']]);

  await page.goto('/net-worth');
  await expect(page.getByTestId('investments-value')).toHaveText('Rp 15.000.000');
  await expect(page.getByTestId('kind-total-invest')).toHaveText('Rp 15.000.000');
  await expect(page.getByTestId('investments-gain')).toContainText('Rp 0');
  await expect(page.getByTestId('investments-box').getByRole('link', { name: 'Dividends' })).toHaveAttribute('href', '/net-worth/investments/dividends');
  await expect(page.getByTestId('investments-box').getByRole('link', { name: 'Trades' })).toHaveAttribute('href', '/net-worth/investments/trades');
});
