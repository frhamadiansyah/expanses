import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addForm, addTransaction, choosePayment, openAmount, saveButton } from './add-transaction';
import { cardPage, closePaidBubble, openPaidBubble, paidTick, payCard, payStatementPurchases, startPlan } from './card-section';

/*
 * One paid look (owner, 21 Nov 2026): every way a purchase is paid wears the same green ✓. The rows keep their date and
 * card digits; how it was paid is in a small dark bubble a tap on the ✓ opens (mockup A, 21 Nov). One closed statement
 * holds a purchase in each state. Invented names and figures. With STATEMENT_SHOTS set to a folder, the 390px statement
 * is saved there with a bubble open, light and dark.
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

test('every paid purchase wears one green ✓, and a tap on it says how it was paid', async ({ page }) => {
  // Seven purchases through the Add screen, two payments and every bubble: close to a minute on its own.
  test.slow();
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

  // The rows are plain: the date, then the card's digits. No words about paying on any of them.
  for (const what of ['Restoran Contoh', 'SPBU Contoh', 'Toko Sepatu Contoh', 'Toko Buku Contoh', 'Apotek Contoh', 'Refund Toko Contoh']) {
    await expect(line(page, what)).toContainText(/\d+ \w+ · ···· 4417/);
    await expect(line(page, what)).not.toContainText(/Paid|Settled/);
  }
  await expect(line(page, 'Kursi Contoh').getByTestId('instalment-pill')).toHaveText('1 of 12');
  await expect(page.getByTestId('statement-legend')).toHaveCount(0);
  await expect(page.getByTestId('statement-group')).toContainText(/3 of 5 paid/i);
  // Not paid, and picked to pay: no paid ✓ to tap.
  await expect(paidTick(line(page, 'Toko Buku Contoh'))).toHaveCount(0);
  await expect(paidTick(line(page, 'Apotek Contoh'))).toHaveCount(0);

  // Each ✓'s bubble, and its name, which a screen reader hears without the tap.
  const states: { what: string; how: string | RegExp; detail: string | RegExp | null; button: string | null }[] = [
    { what: 'Restoran Contoh', how: /^Paid \d+ \w+$/, detail: /^Rp\s520\.000 from Bank Contoh$/, button: 'Open payment' },
    { what: 'SPBU Contoh', how: /^Paid with the \d+ \w+ payment$/, detail: /^Rp\s340\.000 from Bank Contoh$/, button: 'Open payment' },
    { what: 'Toko Sepatu Contoh', how: 'Paid off', detail: null, button: 'Not paid off' },
    { what: 'Refund Toko Contoh', how: 'Settled', detail: null, button: 'Not settled' },
    { what: 'Kursi Contoh', how: 'Paid', detail: null, button: 'Not paid' },
  ];
  for (const state of states) {
    const row = line(page, state.what);
    await expect(paidTick(row)).toHaveAccessibleName(typeof state.how === 'string' ? `${state.what}, ${state.how}` : new RegExp(`^${state.what}, ${state.how.source.slice(1)}`));
    const bubble = await openPaidBubble(page, row);
    await expect(bubble.getByTestId('statement-paid-how')).toHaveText(state.how);
    if (state.detail) await expect(bubble.getByTestId('statement-paid-detail')).toHaveText(state.detail);
    else await expect(bubble.getByTestId('statement-paid-detail')).toHaveCount(0);
    await expect(bubble.getByRole('button')).toHaveCount(state.button ? 1 : 0);
    if (state.button) await expect(bubble.getByRole('button', { name: state.button, exact: true })).toBeVisible();
    await closePaidBubble(page, row);
  }

  // One bubble at a time: a tap on another ✓ moves it there, a second tap on that ✓ shuts it.
  await openPaidBubble(page, line(page, 'SPBU Contoh'));
  await paidTick(line(page, 'Restoran Contoh')).click();
  await expect(page.getByTestId('statement-paid-bubble')).toHaveCount(1);
  await expect(page.getByTestId('statement-paid-how')).toHaveText(/^Paid \d+ \w+$/);
  await expect(paidTick(line(page, 'SPBU Contoh'))).toHaveAttribute('aria-expanded', 'false');
  await paidTick(line(page, 'Restoran Contoh')).click();
  await expect(page.getByTestId('statement-paid-bubble')).toHaveCount(0);

  // Not paid off from the bubble asks first, in the same sheet as before; closed, nothing changed.
  await (await openPaidBubble(page, line(page, 'Toko Sepatu Contoh'))).getByRole('button', { name: 'Not paid off' }).click();
  await expect(page.getByTestId('statement-paid-bubble')).toHaveCount(0);
  await expect(page.getByTestId('statement-not-paid-off')).toHaveText('Not paid off');
  await page.getByRole('dialog', { name: 'Already paid off' }).getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('statement-not-paid-off')).toHaveCount(0);
  await expect(line(page, 'Toko Sepatu Contoh').getByTestId('statement-paid-off')).toBeVisible();

  // The covered ✓'s bubble opens the payment that covered it.
  await (await openPaidBubble(page, line(page, 'SPBU Contoh'))).getByRole('button', { name: 'Open payment' }).click();
  await expect(page).toHaveURL(/\/transactions\/[^/]+$/);
  await page.goBack();
  await expect(line(page, 'SPBU Contoh')).toBeVisible();

  const shots = process.env.STATEMENT_SHOTS;
  if (shots) {
    // With the covered ✓'s bubble open: the rows, clear of the tab bar floating over them, and the screen as it stands.
    await line(page, 'SPBU Contoh').scrollIntoViewIfNeeded();
    await openPaidBubble(page, line(page, 'SPBU Contoh'));
    const rows = page.getByTestId('statement-group');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const box = (await rows.boundingBox())!;
      await page.screenshot({ path: `${shots}/statement-paid-bubble-rows-${scheme}.png`, clip: { x: 0, y: box.y - 8, width: 390, height: box.height + 16 } });
      await page.screenshot({ path: `${shots}/statement-paid-bubble-${scheme}.png` });
    }
  }
});
