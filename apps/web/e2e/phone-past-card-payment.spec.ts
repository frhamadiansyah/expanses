import { expect, type Page, test } from '@playwright/test';
import { expectWalletFigure, openAccount, openCard, walletCard } from './accounts';
import { addForm, addTransaction, choosePayment, chooseTo, fillAmount, openAmount, saveButton } from './add-transaction';
import { cardPage, chooseCardPayFrom, openCardPay, saveCardTerms, showCardBack } from './card-section';

/*
 * The start day rule for card payments and transfers (owner, 22 Nov 2026): money paid out of an account on a day before
 * that account was added leaves its balance as it is — its starting balance already holds it — while the card being
 * paid owes less. One plain line on the form, no choice. Today is pinned to 22 November 2026. Invented names and figures.
 */
const TODAY = new Date('2026-11-22T12:00:00');
const SHOTS = process.env.PAST_PAY_SHOTS;

test.beforeEach(async ({ page }) => {
  await page.clock.setSystemTime(TODAY);
});

async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '7350000', opened: '2026-11-20' });
  await openCard(page, { name: 'Kartu Contoh' });
  await page.goto('/wallet');
  await walletCard(page, 'Kartu Contoh').click();
  await cardPage(page, 'Settings');
  await page.getByLabel('Billing date').fill('20');
  await page.getByLabel('Due date').fill('5');
  await saveCardTerms(page);
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Toko Contoh', paidWith: 'Kartu Contoh', category: 'Groceries', amount: '2970000', date: '2026-10-15', paidOff: false });
}

async function openCardPage(page: Page) {
  await page.goto('/wallet');
  await walletCard(page, 'Kartu Contoh').click();
  await expect(page).toHaveURL(/\/cards\/[^/?]+$/);
}

test('Pay credit card dated before the bank was added: one line says so, the bank stays, the card owes less', async ({ page }) => {
  await setUp(page);
  await openCardPage(page);
  const form = await openCardPay(page);
  await chooseCardPayFrom(form, 'Bank Contoh');
  await form.getByRole('button', { name: 'Clear amount' }).click();
  await openAmount(form);
  await fillAmount(page, form, '1710000');
  // On or after the bank's day: no line.
  await form.getByLabel('Date').fill('2026-11-21');
  await expect(form.getByTestId('before-start-line')).toHaveCount(0);
  // Before it: the one line, and no switch or choice beside it.
  await form.getByLabel('Date').fill('2026-11-12');
  await expect(form.getByTestId('before-start-line')).toHaveText('Before Bank Contoh was added: its balance stays.');
  await expect(form.getByRole('switch')).toHaveCount(0);
  await expect(form.getByRole('button', { name: 'Past purchase' })).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/past-pay-form.png` });
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  // The card owes the rest, the October statement shows the purchase covered in part.
  await openCardPage(page);
  await showCardBack(page);
  await expect(page.getByTestId('tile-unpaid-balance')).toContainText('1.260.000');
  await cardPage(page, 'Statement');
  // Today's is 21 Nov – 20 Dec; the purchase is two statements back, on 21 Sep – 20 Oct.
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-line').filter({ hasText: 'Toko Contoh' })).toContainText(/1\.710\.000 covered, Rp\s1\.260\.000 left/);

  // The bank is as it was added.
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Bank Contoh', '7.350.000');

  // The receipt names the account that stayed; the balancing pair is on no list.
  await page.goto('/transactions?month=2026-11');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Settled before the app' })).toHaveCount(0);
  await page.goto(`/transactions?account=${await accountIdOf(page, 'Kartu Contoh')}`);
  await page.getByText('Credit card payment').first().click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-f-]+$/);
  await expect(page.getByTestId('receipt-past')).toContainText('Past payment');
  await expect(page.getByTestId('receipt-past')).toContainText('Bank Contoh unchanged');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/past-pay-receipt.png` });

  // Edited onto a day after the bank was added, the bank pays it after all.
  await page.getByRole('button', { name: 'Edit this transaction' }).click();
  const edit = page.getByRole('form', { name: 'Edit a transaction' });
  await expect(edit.getByTestId('before-start-line')).toHaveText('Before Bank Contoh was added: its balance stays.');
  await edit.getByLabel('Date').fill('2026-11-21');
  await expect(edit.getByTestId('before-start-line')).toHaveCount(0);
  await saveButton(edit).click();
  await expect(edit).toHaveCount(0);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Bank Contoh', '5.640.000');
});

test('a transfer between own accounts: each side follows its own account’s day', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '7350000', opened: '2026-11-20' });
  await openAccount(page, { subtype: 'savings', name: 'Tabungan Lama', balance: '2640000', opened: '2026-01-05' });
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await form.getByRole('radio', { name: 'Transfer', exact: true }).click();
  await form.getByRole('button', { name: 'From' }).click();
  await choosePayment(page, 'Tabungan Lama', 'From');
  await openAmount(form);
  await fillAmount(page, form, '400000');
  await chooseTo(form, 'Bank Contoh');
  await form.getByLabel('Note').fill('Pindah');
  await form.getByLabel('Date').fill('2026-11-10');
  // The money arrived before Bank Contoh was added: Bank Contoh stays, Tabungan Lama pays it.
  await expect(form.getByTestId('before-start-line')).toHaveText('Before Bank Contoh was added: its balance stays.');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/wallet');
  await expectWalletFigure(page, 'Bank Contoh', '7.350.000');
  await expectWalletFigure(page, 'Tabungan Lama', '2.240.000');
});

/** An account's id, read from its page's address. */
async function accountIdOf(page: Page, name: string): Promise<string> {
  await page.goto('/wallet');
  await walletCard(page, name).click();
  await expect(page).toHaveURL(/\/(accounts|cards)\/[^/?]+$/);
  return /\/(?:accounts|cards)\/([^/?#]+)/.exec(page.url())![1]!;
}
