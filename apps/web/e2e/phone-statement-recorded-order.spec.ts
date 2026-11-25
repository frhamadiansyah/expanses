import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import { addTransaction } from './add-transaction';
import { cardPage, openPaidBubble, closePaidBubble, paidTick, payCard } from './card-section';

/*
 * A card payment pays first what was on the card when it was recorded (owner, 25 Nov 2026, "option 3"). Three purchases
 * on the 23rd, a payment for exactly them, and — recorded after the payment — two older purchases from the 22nd that
 * were paid elsewhere. The payment stays with the three; the two show unpaid, so each can be marked Paid off, and the
 * statement ends all paid. Invented names and figures.
 */
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
/** A day of last month: with a statement on the last day, always on the previous statement. */
const lastMonth = (day: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, day);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const line = (page: Page, what: string) => page.getByTestId('statement-line').filter({ hasText: what });

async function openLastStatement(page: Page) {
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await cardPage(page, 'Statement');
  await page.getByRole('button', { name: 'Earlier statement' }).click();
}

test('purchases recorded after a payment never take it from the purchases it paid', async ({ page }) => {
  // Five purchases through the Add screen, a payment and two marks.
  test.slow();
  await openAccount(page, { subtype: 'bank', name: 'Bank Contoh', balance: '20000000' });
  await openCard(page, { name: 'Kartu Contoh', last4: '4417', statementDay: '31', dueDay: '15' });
  await page.goto('/transactions');
  const buy = (description: string, amount: string, day: number) =>
    addTransaction(page, { description, paidWith: 'Kartu Contoh', category: 'Groceries', amount, date: lastMonth(day), paidOff: false });
  await buy('Toko Satu', '400000', 23);
  await buy('Toko Dua', '350000', 23);
  await buy('Toko Tiga', '250000', 23);
  await page.goto('/wallet');
  await page.getByRole('link', { name: /^Kartu Contoh/ }).first().click();
  await payCard(page, { from: 'Bank Contoh', amount: '1000000' });

  // Recorded well after the payment (rows seconds apart count as recorded together), though dated a day earlier.
  await page.waitForTimeout(6_000);
  await page.goto('/transactions');
  await buy('Toko Lama', '120000', 22);
  await buy('Warung Lama', '80000', 22);

  await openLastStatement(page);
  await expect(page.getByTestId('statement-line')).toHaveCount(5);
  await expect(page.getByTestId('statement-group')).toContainText(/3 of 5 paid/i);
  for (const what of ['Toko Satu', 'Toko Dua', 'Toko Tiga']) {
    const row = line(page, what);
    await expect(paidTick(row)).toHaveAccessibleName(new RegExp(`^${what}, Paid with the \\d+ \\w+ payment$`));
    const bubble = await openPaidBubble(page, row);
    await expect(bubble.getByTestId('statement-paid-detail')).toHaveText(/^Rp\s1\.000\.000 from Bank Contoh$/);
    await closePaidBubble(page, row);
  }
  // The two recorded later are still to pay: ticked to pay, not covered.
  for (const what of ['Toko Lama', 'Warung Lama']) {
    await expect(paidTick(line(page, what))).toHaveCount(0);
    await expect(page.getByLabel(`Pay ${what}`, { exact: true })).toBeVisible();
  }

  // Paid elsewhere: each marked Paid off from its ⋯, and the statement is all paid.
  for (const what of ['Toko Lama', 'Warung Lama']) {
    await line(page, what).getByRole('button', { name: `Actions for ${what}` }).click();
    const sheet = page.getByRole('dialog', { name: what });
    await sheet.getByRole('button', { name: 'Paid off', exact: true }).click();
    await expect(sheet).toHaveCount(0);
    await expect(line(page, what).getByTestId('statement-paid-off')).toBeVisible();
  }
  await expect(page.getByTestId('statement-group')).toContainText(/All paid/i);
  for (const what of ['Toko Satu', 'Toko Dua', 'Toko Tiga']) await expect(line(page, what).getByTestId('statement-covered')).toBeVisible();
});
