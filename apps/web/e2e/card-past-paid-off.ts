import { expect, type Page, type TestInfo } from '@playwright/test';
import { expectWalletFigure, openCard } from './accounts';
import { addForm, choosePayment, fillAmount, openAmount, saveButton } from './add-transaction';
import { cardPage } from './card-section';

/*
 * A card purchase dated before the card was added starts out paid off (owner, 22 Nov 2026), the way a money account's
 * starts out a past purchase: the card owed what it owed when it was added, old purchases included. Written once for
 * both widths. Today is pinned to 20 September 2026; the card is added that day owing Rp 1.500.000 and bills on the
 * 25th, so 10 and 20 September sit on one open statement. Every name and figure is invented.
 */
export const TODAY = new Date('2026-09-20T12:00:00');
export const CARD = 'Kartu Contoh';

export async function addCard(page: Page) {
  await page.clock.setSystemTime(TODAY);
  await openCard(page, { name: CARD, owed: '1500000', statementDay: '25', dueDay: '10' });
}

async function openStatement(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: CARD }).first().click();
  await cardPage(page, 'Statement');
}

/** Paste a list on the card: one line before the day it was added, one on it. */
export async function pasteOldAndNew(page: Page, info: TestInfo) {
  await page.goto('/transactions/new');
  await page.getByRole('button', { name: 'Paste a list', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions\/paste/);
  await page.getByLabel('Purchases').fill('10/09\nwarung lama 45000\n20/09\nkopi baru 30000');
  await page.getByRole('button', { name: 'Payment method' }).click();
  await choosePayment(page, CARD);
  await page.getByRole('button', { name: 'Review 2' }).click();
  await page.getByRole('button', { name: 'Save list' }).click();
  await expect(page.getByTestId('toast')).toHaveText('Added 2 purchases');

  // The card owes what it was added with, and the new purchase on top: the old one is in what it owed already.
  await page.goto('/wallet');
  await expectWalletFigure(page, CARD, '1.530.000');

  await openStatement(page);
  const old = page.getByTestId('statement-line').filter({ hasText: 'warung lama' });
  const fresh = page.getByTestId('statement-line').filter({ hasText: 'kopi baru' });
  await expect(old.getByTestId('statement-paid-off')).toBeVisible();
  await expect(page.getByLabel('Pay warung lama')).toHaveCount(0);
  await expect(fresh.getByTestId('statement-paid-off')).toHaveCount(0);
  await expect(page.getByLabel('Pay kopi baru')).toBeVisible();
  await page.screenshot({ path: info.outputPath('statement-after-paste.png') });
}

async function fillOnCard(page: Page, date: string) {
  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  await fillAmount(page, form, '64000');
  await form.getByRole('button', { name: /^Payment method/ }).click();
  await choosePayment(page, CARD);
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Restaurants', exact: true }).click();
  await form.getByLabel('Note').fill('Bakmi Contoh');
  await form.getByLabel('Date').fill(date);
  return form;
}

/** The Add form ticks the card's icon by itself for an old date, and a tap takes it off for that purchase. */
export async function addFormHintAndToggle(page: Page, info: TestInfo) {
  const form = await fillOnCard(page, '2026-09-12');
  const paidOff = form.getByRole('button', { name: 'Already paid off' });
  await expect(paidOff).toHaveAttribute('aria-pressed', 'true');
  await expect(form.getByTestId('paid-off-tick')).toBeVisible();
  await page.screenshot({ path: info.outputPath('add-form-card-paid-off.png') });
  // The card's own day is an ordinary, owed purchase; back to the old date, ticked again until a tap says otherwise.
  await form.getByLabel('Date').fill('2026-09-20');
  await expect(paidOff).toHaveAttribute('aria-pressed', 'false');
  await expect(form.getByTestId('paid-off-tick')).toHaveCount(0);
  await form.getByLabel('Date').fill('2026-09-12');
  await expect(paidOff).toHaveAttribute('aria-pressed', 'true');
  await paidOff.click();
  await expect(paidOff).toHaveAttribute('aria-pressed', 'false');
  await expect(form.getByTestId('paid-off-tick')).toHaveCount(0);
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // Switched off, it is owed like any other.
  await page.goto('/wallet');
  await expectWalletFigure(page, CARD, '1.564.000');
}

/** Left ticked, the old purchase is spending in its month and the card owes what it did. */
export async function addFormKeepsTicked(page: Page) {
  const form = await fillOnCard(page, '2026-09-12');
  await expect(form.getByRole('button', { name: 'Already paid off' })).toHaveAttribute('aria-pressed', 'true');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await page.goto('/wallet');
  await expectWalletFigure(page, CARD, '1.500.000');
  await page.goto('/transactions?month=2026-09');
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Bakmi Contoh' })).toHaveCount(1);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Settled before the app' })).toHaveCount(0);
}
