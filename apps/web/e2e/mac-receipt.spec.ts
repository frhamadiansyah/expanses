import { expect, test } from '@playwright/test';
import { openCard, walletCard } from './accounts';
import { addTransaction, choosePayment, chooseTo } from './add-transaction';
import { mockRates, openWithPockets } from './pockets';
import { peekLine, receiptPeek } from './receipt-peek';

/*
 * The Mac receipt (owner, 18 Nov 2026): on a wide screen a transaction opens as the side peek, never the phone's
 * receipt page — Cashflow's rows by a click (no ⓘ on them any more), and every other desk page's rows over that
 * page's own peek, with ‹ back to it. The peek says every line the receipt says, and does what it does. Invented figures.
 */

/** The day of a month this many months back, in YYYY-MM-DD, and its month. */
function monthsAgo(months: number, day: number): { date: string; month: string } {
  const now = new Date();
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day));
  return { date: at.toISOString().slice(0, 10), month: at.toISOString().slice(0, 7) };
}

test('a card purchase’s peek is its receipt: Instalments None, Turn into instalments from it, spread over 6 months; no ⓘ on the row', async ({ page }) => {
  const bought = monthsAgo(1, 10);
  await openCard(page, { name: 'Kartu Biru', last4: '4417', statementDay: '31', dueDay: '15' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Laptop', paidWith: 'Kartu Biru', category: 'Groceries', amount: '12000000', date: bought.date });

  await page.goto(`/transactions?month=${bought.month}`);
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Laptop' });
  await expect(row).toBeVisible();
  // A recorded row has no ⓘ: its click is the way in.
  await expect(page.getByRole('link', { name: /^Receipt for / })).toHaveCount(0);
  await row.click();
  const peek = page.getByTestId('cashflow-peek');
  await expect(peek.getByTestId('peek-title')).toHaveText('Laptop');
  await expect(peek.getByTestId('peek-amount')).toHaveText(/^Rp\s12\.000\.000$/);
  // The panel (owner, 2026-11-24): the category under the figure; what paid in the first grey box (its Total is the
  // figure, so not said again), then the Instalments row in the second.
  await expect(peek.getByTestId('peek-kind')).toHaveText(/^Groceries/);
  await expect(peek.getByTestId('peek-money').locator('dt')).toContainText(['Paid with', 'Workspace']);
  await expect(peekLine(peek, 'Paid with')).toContainText('Kartu Biru ···· 4417');
  const instalments = peek.getByTestId('receipt-instalments');
  await expect(instalments).toContainText('None');
  // Never the phone's page: the address stays Cashflow's.
  await expect(page).toHaveURL(/\/transactions\?month=/);

  await instalments.click();
  const sheet = page.getByRole('dialog', { name: 'Turn into instalments' });
  await expect(sheet).toContainText('Laptop');
  await sheet.getByRole('radio', { name: '6', exact: true }).click();
  await sheet.getByTestId('turn-into-save').click();
  await expect(sheet).toHaveCount(0);

  // The peek says it is spread, and its Instalments row names the plan.
  await expect(peek.getByTestId('spread-caption')).toContainText(/Spread over 6 months · counts Rp\s0 now/);
  await expect(instalments).toContainText(/6 × Rp\s2\.000\.000/);
  // The plan's row opens the plan's page.
  await instalments.click();
  await expect(page.getByTestId('instalment-plan-page')).toBeVisible();
});

test('a foreign transfer opened from Wallet’s peek is its receipt, with Rate, over the card’s peek and back to it', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await mockRates(page, { SGD: 12_680 });
  await openWithPockets(page, {
    name: 'Valas Plus',
    bank: 'Bank One',
    shown: 'Bank One Valas Plus',
    pockets: [
      { currency: 'USD', balance: '2400.00', rate: '16250' },
      { currency: 'IDR', balance: '5400000' },
    ],
  });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(page, 'Bank One Valas Plus · USD', 'From');
  await form.getByLabel('Amount', { exact: true }).pressSequentially('100');
  await chooseTo(form, 'Bank One Valas Plus · IDR (IDR)');
  await form.getByLabel('Received amount (IDR)').pressSequentially('1630000');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);

  await page.goto('/wallet');
  await walletCard(page, 'Bank One Valas Plus').click();
  const wallet = page.getByTestId('wallet-peek');
  await expect(wallet).toBeVisible();
  await wallet.getByTestId('peek-recent-row').first().click();

  const peek = receiptPeek(page);
  await expect(peek).toBeVisible();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(peekLine(peek, 'Rate')).toContainText('Rp 16.300 per USD');
  // ‹ back to the card's peek, which it covered.
  await peek.getByRole('button', { name: 'Back to Bank One Valas Plus' }).click();
  await expect(peek).toHaveCount(0);
  await expect(wallet.getByTestId('peek-title')).toHaveText('Bank One Valas Plus');
  // Esc puts the receipt away and leaves the card's peek; a second Esc closes that.
  await wallet.getByTestId('peek-recent-row').first().click();
  await expect(peek).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(peek).toHaveCount(0);
  await expect(wallet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(wallet).toHaveCount(0);
});
