import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction, fillAmount, openAmount, saveButton } from './add-transaction';
import { cardPage, chooseCardPayFrom, openStatementPay, paidTick } from './card-section';

/*
 * Pay one purchase, own amount (owner, 25 Nov 2026): one purchase ticked on the statement, Pay lets its amount be typed.
 * Less pays part of it, which then shows half paid with what is left, and ticking it again pays the rest; more pays it
 * and the extra goes to the card's other purchases. Several ticked: their total, fixed. Invented names and figures.
 * With PAY_ONE_SHOTS set to a folder, the Pay screen (less, more) and the statement after a part payment are saved there.
 */
const SHOTS = process.env.PAY_ONE_SHOTS;
const line = (page: Page, what: string) => page.getByTestId('statement-line').filter({ hasText: what });

async function setUp(page: Page) {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '20000000' });
  // The 31st is each month's last day: today is always on the open statement.
  await openCard(page, { name: 'Kartu Contoh', last4: '4417', statementDay: '31', dueDay: '15' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Warung Contoh', paidWith: 'Kartu Contoh', category: 'Groceries', amount: '100000' });
  await addTransaction(page, { description: 'Toko Sepatu Contoh', paidWith: 'Kartu Contoh', category: 'Groceries', amount: '450000' });
}

async function openStatement(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await cardPage(page, 'Statement');
}

/** Ticks the one purchase, opens Pay, and types the amount over the one it opened with. */
async function payTyped(page: Page, what: string, amount: string, opensWith: RegExp) {
  await page.getByLabel(`Pay ${what}`, { exact: true }).check();
  const form = await openStatementPay(page);
  await expect(page.getByTestId('paying-purchases')).toContainText('Paying 1 purchase');
  const button = form.getByRole('button', { name: 'Amount', exact: true });
  await expect(button).toHaveText(opensWith);
  await expect(button).toBeEnabled();
  await form.getByRole('button', { name: 'Clear amount' }).click();
  await openAmount(form);
  await fillAmount(page, form, amount);
  await chooseCardPayFrom(form, 'Bank Contoh');
  return form;
}

test('one purchase paid with less keeps the rest to pay, and ticking it again pays the rest', async ({ page }) => {
  test.slow();
  await setUp(page);
  await openStatement(page);

  const form = await payTyped(page, 'Toko Sepatu Contoh', '300000', /^450\.000$/);
  await expect(page.getByTestId('paying-note')).toHaveText(/^Toko Sepatu Contoh: Rp\s150\.000 left to pay$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pay-less.png` });
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  await expect(page).toHaveURL(/\/cards\/[^/]+\/statement$/);

  // Half paid, what is left said; the older purchase a lump payment would have paid first is untouched.
  const shoes = line(page, 'Toko Sepatu Contoh');
  await expect(shoes).toContainText(/Rp\s150\.000 left/);
  await expect(shoes.getByTestId('statement-part-paid')).toBeVisible();
  await expect(paidTick(shoes)).toHaveCount(0);
  await expect(line(page, 'Warung Contoh')).not.toContainText(' left');
  await expect(page.getByTestId('statement-group')).toContainText(/0 of 2 paid/i);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/statement-after-part.png` });

  // Ticked again: Pay opens at what is left, and pays it.
  await page.getByLabel('Pay Toko Sepatu Contoh', { exact: true }).check();
  const rest = await openStatementPay(page);
  await expect(rest.getByRole('button', { name: 'Amount', exact: true })).toHaveText(/^150\.000$/);
  await expect(page.getByTestId('paying-note')).toHaveCount(0);
  await chooseCardPayFrom(rest, 'Bank Contoh');
  await saveButton(rest).click();
  await expect(rest).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Toko Sepatu Contoh, Paid \d+ \w+$/ })).toBeVisible();
  await expect(page.getByTestId('statement-group')).toContainText(/1 of 2 paid/i);
  await expect(line(page, 'Warung Contoh')).not.toContainText(' left');
});

test('one purchase paid with more is paid whole, and the extra goes to the card’s other purchases', async ({ page }) => {
  test.slow();
  await setUp(page);
  await openStatement(page);

  // Two ticked: their total, fixed, as before.
  await page.getByLabel('Pay Warung Contoh', { exact: true }).check();
  await page.getByLabel('Pay Toko Sepatu Contoh', { exact: true }).check();
  const both = await openStatementPay(page);
  await expect(both.getByRole('button', { name: 'Amount', exact: true })).toBeDisabled();
  // Back on the statement afresh, nothing ticked.
  await openStatement(page);
  await expect(page.getByTestId('statement-select-bar')).toHaveCount(0);

  const form = await payTyped(page, 'Toko Sepatu Contoh', '500000', /^450\.000$/);
  await expect(page.getByTestId('paying-note')).toHaveText(/^Rp\s50\.000 extra goes to the card’s other purchases$/);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pay-more.png` });
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await expect(page.getByRole('button', { name: /^Toko Sepatu Contoh, Paid \d+ \w+$/ })).toBeVisible();
  const warung = line(page, 'Warung Contoh');
  await expect(warung).toContainText(/Rp\s50\.000 left/);
  await expect(warung.getByTestId('statement-part-paid')).toBeVisible();
});
