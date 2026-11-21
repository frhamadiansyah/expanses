import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addForm, addTransaction, choosePayment, openAmount, saveButton } from './add-transaction';
import { cardPage, payCard, payStatementPurchases, startPlan } from './card-section';

/*
 * One paid look (owner, 21 Nov 2026): every way a purchase is paid wears the same green ✓, and how it was paid is said
 * in green words where the row's date otherwise is. One closed statement holds a purchase in each state. Invented
 * names and figures. With STATEMENT_SHOTS set to a folder, the 390px statement is saved there, light and dark.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
/** A day of last month: with a statement on the last day, always on the previous statement. */
const lastMonth = (day: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const line = (page: Page, what: string) => page.getByTestId('statement-line').filter({ hasText: what });

/** The ⋯ at the end of a statement line, and the sheet it opens, titled with the line. */
async function act(page: Page, description: string, action: string) {
  await line(page, description).getByRole('button', { name: `Actions for ${description}` }).click();
  const sheet = page.getByRole('dialog', { name: description });
  await sheet.getByRole('button', { name: action, exact: true }).click();
  await expect(sheet).toHaveCount(0);
}

async function openStatement(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await cardPage(page, 'Statement');
}

test('every paid purchase wears one green ✓, with how it was paid in words where its date was', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '20000000' });
  await openCard(page, { name: 'Kartu Contoh', last4: '4417', statementDay: '31', dueDay: '15' });
  // A plan whose purchase is not in the app, first billed last month: its first instalment, due before today, is ticked paid.
  await startPlan(page);
  const plan = page.getByRole('dialog', { name: 'New instalment plan' });
  await plan.getByLabel('What it was').fill('Kursi Contoh');
  await plan.getByLabel(/^Total/).fill('2400000');
  await plan.getByLabel('Months').fill('12');
  await plan.getByLabel('First billed').fill(lastMonth(1).slice(0, 7));
  await plan.getByRole('button', { name: 'Save plan' }).click();
  await expect(plan).toHaveCount(0);

  // Oldest first, a payment covers the oldest purchase not settled on its own: the petrol.
  await page.goto('/transactions');
  const buy = (description: string, amount: string, day: number) =>
    addTransaction(page, { description, paidWith: 'Kartu Contoh', category: 'Groceries', amount, date: lastMonth(day) });
  await buy('Restoran Contoh', '520000', 3);
  await buy('SPBU Contoh', '340000', 5);
  await buy('Toko Sepatu Contoh', '410000', 8);
  await buy('Toko Buku Contoh', '310000', 18);
  await buy('Apotek Contoh', '450000', 21);
  // Money back on the card, typed minus-first on the keypad.
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = addForm(page);
  await openAmount(form);
  const keypad = page.getByTestId('keypad');
  for (const key of ['−', ...'120000']) await keypad.getByRole('button', { name: key, exact: true }).click();
  await keypad.getByRole('button', { name: 'DONE' }).click();
  await form.getByRole('button', { name: /^Into/ }).click();
  await choosePayment(page, 'Kartu Contoh', 'Into');
  await form.getByRole('button', { name: /^Category/ }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await form.getByLabel('Note').fill('Refund Toko Contoh');
  await form.getByLabel('Date').fill(lastMonth(27));
  await saveButton(form).click();
  await expect(form).toHaveCount(0);

  await openStatement(page);
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  await expect(page.getByTestId('statement-line')).toHaveCount(7);

  // Paid off before cicis, and the refund settled, from each line's ⋯.
  await act(page, 'Toko Sepatu Contoh', 'Paid off');
  await act(page, 'Refund Toko Contoh', 'Settled');
  // Paid one by one: ticked and paid on its own.
  await page.getByLabel('Pay Restoran Contoh').check();
  await payStatementPurchases(page, 'Bank Contoh');
  // A lump payment from the card's Pay, for exactly the petrol: it covers it whole.
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await payCard(page, { from: 'Bank Contoh', amount: '340000' });
  await openStatement(page);
  await page.getByRole('button', { name: 'Earlier statement' }).click();
  // Picked to pay, not paid yet.
  await page.getByLabel('Pay Apotek Contoh').check();

  // The words, each in place of the date; the card's digits still follow.
  const how = (what: string) => line(page, what).getByTestId('statement-paid-how');
  await expect(how('Restoran Contoh')).toHaveText(/^Paid \d+ \w+$/);
  await expect(how('SPBU Contoh')).toHaveText(/^Paid with the \d+ \w+ payment$/);
  await expect(how('Toko Sepatu Contoh')).toHaveText('Paid before cicis');
  await expect(how('Refund Toko Contoh')).toHaveText('Settled');
  await expect(how('Kursi Contoh')).toHaveText('Paid');
  await expect(line(page, 'Kursi Contoh').getByTestId('instalment-pill')).toHaveText('1 of 12');
  await expect(how('Toko Buku Contoh')).toHaveCount(0);
  await expect(how('Apotek Contoh')).toHaveCount(0);
  // "Paid with the … payment" fills the subtitle: the card's digits give way to it; a shorter one keeps them.
  await expect(line(page, 'SPBU Contoh')).not.toContainText('···· 4417');
  await expect(line(page, 'Restoran Contoh')).toContainText('···· 4417');
  await expect(line(page, 'Toko Buku Contoh')).toContainText(/\d+ \w+ · ···· 4417/);
  // No legend under the statement: the rows say it.
  await expect(page.getByTestId('statement-legend')).toHaveCount(0);
  await expect(page.getByTestId('statement-group')).toContainText(/3 of 5 paid/i);

  // The taps are as before: the covered ✓ names its payment, the paid-off one offers to take it back.
  await line(page, 'SPBU Contoh').getByTestId('statement-covered').click();
  const why = page.getByRole('dialog', { name: 'SPBU Contoh' });
  await expect(why).toContainText('Covered by');
  await why.getByRole('button', { name: 'Close' }).click();
  await expect(why).toHaveCount(0);
  await line(page, 'Toko Sepatu Contoh').getByTestId('statement-paid-off').click();
  await expect(page.getByTestId('statement-not-paid-off')).toHaveText('Not paid off');
  await page.getByRole('dialog', { name: 'Already paid off' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('statement-not-paid-off')).toHaveCount(0);

  const shots = process.env.STATEMENT_SHOTS;
  if (shots) {
    // The rows alone, clear of the tab bar floating over them, and the whole screen as it stands.
    const rows = page.getByTestId('statement-group');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await rows.screenshot({ path: `${shots}/statement-paid-look-rows-${scheme}.png` });
      await page.screenshot({ path: `${shots}/statement-paid-look-${scheme}.png`, fullPage: true });
    }
  }
});
