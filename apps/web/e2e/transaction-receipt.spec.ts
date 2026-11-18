import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openAccount, openAccountHistory, openCard } from './accounts';
import BetterSqlite3 from 'better-sqlite3';
import { openNewAsset, fillDay, pastPurchase } from './add-asset';
import { addTransaction, closeDetails, shareWith, choosePayment, chooseTradeMoney, openBuyOrSell, saveButton } from './add-transaction';
import { openDrawers } from './drawers';
import { openAsset } from './asset-page';
import { openRowPeek, peekLine } from './receipt-peek';

/** A credit card, so there is something to charge a purchase to. */
async function addCard(page: Page, name = 'BCA Visa') {
  await openCard(page, { name });
}

/** One purchase on that card, through the form a user uses. */
async function spend(page: Page, description: string, amount: string, card = 'BCA Visa') {
  await page.goto('/transactions');
  await addTransaction(page, { description: description, paidWith: `${card}`, category: 'Groceries', amount: amount });
  await expect(page.getByText(description)).toBeVisible();
}

/**
 * A row's receipt on a wide screen, the Mac receipt (the side peek): from Cashflow by a click on the row, or — a buy, an
 * opening balance, which Cashflow does not list (owner 2026-11-16) — from `from`'s history by its ⓘ.
 */
async function openReceipt(page: Page, description: string, from?: string) {
  if (from) await openAccountHistory(page, from);
  else await page.goto('/transactions');
  return openRowPeek(page, description, { history: !!from });
}


/** Show deleted, from Cashflow's Filter menu (Mac Cashflow D). */
async function showDeleted(page: Page) {
  await page.getByRole('button', { name: /^Filter/ }).click();
  await page.getByRole('dialog', { name: 'Filter' }).getByLabel('Show deleted').check();
  await page.keyboard.press('Escape');
}
/**
 * The receipt, reached the way a wide screen reaches it: a click on Cashflow's row opens it as the side peek (the Mac
 * receipt), in place — never the phone's receipt page, and with no ⓘ on the row.
 */
test('a click on a Cashflow row opens its receipt as the peek, in place', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Visa', category: 'Groceries', amount: '500000' });
  await expect(page.getByText('Superindo')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Receipt for Superindo' })).toHaveCount(0);

  const peek = await openRowPeek(page, 'Superindo');
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(peek.getByTestId('peek-title')).toHaveText('Superindo');

  // The figure, not the word: what the card was charged, beside the account that was charged.
  await expect(peekLine(peek, 'Paid with')).toContainText('BCA Visa');
  await expect(peekLine(peek, 'Total')).toContainText('500.000');
  await expect(peek.getByTestId('peek-amount')).toContainText('500.000');
});

/**
 * The refusals the receipt has to inherit, because it is a new way into a transaction and not a new set of
 * rules about one.
 *
 * `TransactionsPage` and `TransactionsTable` both replace a trade row's whole trailing slot with **Holding**, the link
 * to the holding's own page:
 * a trade's units live in `trades`, and the transaction is only its money half. Void it and the cash comes back
 * while the units stay held — Rp 3.980.000 of net worth out of nothing. Edit it and `replaceTransaction` posts a
 * new id, leaving the trade pointing at a transaction that is no longer there. An opening balance is refused for
 * its own reason: it posts against system equity, has no form that can represent it, and deleting one silently
 * rewrites what an account started with.
 *
 * The ⓘ sits in that same trailing slot, so a receipt offering Delete and Edit was a way round both.
 */
test('the receipt refuses what every other screen refuses: a trade, and an opening balance', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());

  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });
  // Opening balances are out of an account's list unless asked for (and never on Cashflow); this test opens one, so it asks.
  await page.evaluate(() => localStorage.setItem('transactions-show-opening', '1'));

  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  // The row is inside its kind's drawer, which the list opens shut.
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();

  const form = await openBuyOrSell(page);
  await form.getByLabel('Grams').fill('2');
  await form.getByLabel(/What it cost, before fees/).fill('3980000');
  await chooseTradeMoney(form, 'BCA Tahapan (IDR)');
  await saveButton(form).click();
  await expect(form).toHaveCount(0);
  // Trade goes back to Net worth, where it was opened; the bank's history lists it (not Cashflow, owner 2026-11-16).
  await openAccountHistory(page, 'BCA Tahapan');
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();

  // Cash down 3,98 M, gold up 3,98 M: buying something changes nothing about what you are worth.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');

  // Read only, the same receipt: its lines, why it is not changed here, and Open holding instead of the buttons.
  const trade = await openReceipt(page, 'Bought 2 Antam gold bars', 'BCA Tahapan');
  await expect(page).toHaveURL(/\/transactions\?account=/);
  await expect(peekLine(trade, 'Paid with')).toContainText('BCA Tahapan');
  await expect(peekLine(trade, 'Total')).toContainText('3.980.000');
  await expect(trade.getByTestId('peek-notice')).toHaveText('A trade is changed on its holding’s page.');
  await expect(trade.getByRole('button', { name: 'Open holding', exact: true })).toBeVisible();
  await expect(trade.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
  await expect(trade.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await expect(trade.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(trade.getByRole('button', { name: 'Split', exact: true })).toHaveCount(0);
  // The list keeps clear of it: the row's figure is not under the peek.
  const amount = page.getByTestId('transaction-row').filter({ hasText: 'Bought 2 Antam gold bars' });
  expect((await amount.boundingBox())!.x + (await amount.boundingBox())!.width).toBeLessThanOrEqual((await trade.boundingBox())!.x + 1);
  await trade.getByRole('button', { name: 'Open holding', exact: true }).click();
  await expect(page).toHaveURL(/\/net-worth\/assets\/[^/?]+$/);

  // And nothing about opening the receipt moved the money.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');

  const opening = await openReceipt(page, 'Opening balance: BCA Tahapan', 'BCA Tahapan');
  await expect(opening.getByTestId('peek-amount')).toContainText('50.000.000');
  await expect(opening.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
  await expect(opening.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});

/**
 * The destructive action the receipt does carry, and what is left behind when it is used.
 *
 * Two taps, like the list's: `transactions-list.spec.ts` covers the row's, and nothing covered this one. The
 * deleted transaction is still readable afterwards — `includeVoid` is what makes the receipt openable from
 * under Show deleted — and it has to say what it is: a pill, and the amount struck through.
 */
test('deleting from the receipt asks twice, and the deleted receipt says it is deleted', async ({ page }) => {
  await addCard(page);
  await spend(page, 'Superindo', '500000');
  const peek = await openReceipt(page, 'Superindo');

  await peek.getByRole('button', { name: 'Delete this transaction' }).click();
  // Armed, not gone: one press never deletes, and the receipt is still the receipt.
  await expect(peek.getByTestId('peek-amount')).toContainText('500.000');

  await peek.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(peek).toHaveCount(0);
  await expect(page.getByText('Superindo')).toHaveCount(0);

  // Deleted, not destroyed: it reads as deleted, and offers no second way to delete it again.
  await showDeleted(page);
  const deleted = await openRowPeek(page, 'Superindo');
  await expect(deleted.getByText('Deleted', { exact: true })).toBeVisible();
  await expect(deleted.getByTestId('peek-amount')).toHaveClass(/line-through/);
  await expect(deleted.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
  await expect(deleted.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});

/**
 * An edit replaces the transaction — the original is voided and a new one posted under a new id — so the
 * receipt the edit was made from no longer names anything. It lands on the list rather than sitting on a
 * page that is now about a deleted row.
 */
test('an edit from the receipt lands on the list, because the edit replaces the transaction', async ({ page }) => {
  await addCard(page);
  await spend(page, 'Superindo', '500000');
  const peek = await openReceipt(page, 'Superindo');

  // The peek's Edit is the full edit screen, as a double-click on the row opens it.
  await peek.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Edit a transaction' })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('575000');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' }).last()).toContainText('575.000');
});

/**
 * The receipt no longer offers "This was a purchase" (owner, 24 Oct): it was one line too many under a receipt. The
 * desktop list's editor still turns an expense into a purchase (`buy-flow.spec.ts`). A holding exists here, so the
 * receipt would have offered it.
 */
test('the receipt does not offer This was a purchase', async ({ page }) => {
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });

  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await pastPurchase(page);
  await fillDay(page, 'Bought', '2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost', { exact: true }).fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await openDrawers(page);
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'UBS Gold Store', paidWith: 'BCA Tahapan', category: 'Shopping', amount: '3980000' });
  await expect(page.getByText('UBS Gold Store')).toBeVisible();

  const peek = await openReceipt(page, 'UBS Gold Store');
  // Anchored on what the receipt does draw, so the counts below are read off a peek that has finished drawing.
  await expect(peek.getByRole('button', { name: 'Delete this transaction' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'This was a purchase' })).toHaveCount(0);
  // One Edit, the peek's.
  await expect(peek.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(1);
});

/**
 * The two figures a split bill shows one above the other: Rp 100.000 in 3xl type, Rp 400.000 on the line
 * below. Both are true — the first is what the dinner cost the owner, the second is what the card was
 * charged — and with nothing between them the pair reads as an arithmetic mistake.
 */
test('a split bill says which figure is the share and which is the bill', async ({ page }) => {
  await addCard(page);
  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const split = page.getByRole('dialog', { name: 'Add a transaction' });
  await split.getByRole('button', { name: 'Paid with' }).click();
  await choosePayment(page, 'BCA Visa');
  await split.getByLabel('Amount', { exact: true }).fill('400000');
  await split.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await split.getByLabel('Note').fill('Dinner at Plataran');
  const { more, sheet } = await shareWith(page, split, [{ name: 'Andi', owes: '300000' }]);
  await closeDetails(more, sheet);
  await split.getByRole('button', { name: 'Save' }).click();
  await expect(split).toHaveCount(0);
  await expect(page.getByText('Dinner at Plataran')).toBeVisible();

  const peek = await openReceipt(page, 'Dinner at Plataran');
  await expect(peek.getByTestId('peek-amount')).toContainText('100.000');
  await expect(peek).toContainText('My share');
  await expect(peekLine(peek, 'Total')).toContainText('400.000');
});

/**
 * The sentence under the date on a transaction left out of the chart.
 *
 * Nothing in the app sets that flag yet — the control is a later task — so the row is written into a backup
 * from outside and restored, exactly as `photos.spec.ts` plants a `transaction_photos` row. A row written by
 * SQLite is the same row either way, and the sentence is the only thing on the screen that tells a user why
 * a purchase they can see is missing from their spending.
 */
test('a transaction left out of the chart says so on its receipt', async ({ page }, testInfo) => {
  await addCard(page);
  await spend(page, 'Superindo', '500000');

  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const source = join(testInfo.outputDir, 'plain.sqlite3');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, readFileSync((await (await downloaded).path())!));

  const excluded = join(testInfo.outputDir, 'excluded.sqlite3');
  writeFileSync(excluded, readFileSync(source));
  const db = new BetterSqlite3(excluded);
  try {
    const tx = db.prepare("SELECT id, workspace_id AS ws FROM transactions WHERE description = 'Superindo'").get() as { id: string; ws: string };
    db.prepare("INSERT INTO transaction_flags (transaction_id, workspace_id, channel, excluded) VALUES (?, ?, 'offline', 1)").run(tx.id, tx.ws);
  } finally {
    db.close();
  }

  await page.goto('/backup');
  page.once('dialog', (dialog) => void dialog.accept());
  const safety = page.waitForEvent('download');
  await page.locator('input[accept*="sqlite3"]').setInputFiles(excluded);
  await safety;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();

  const peek = await openReceipt(page, 'Superindo');
  await expect(peek.getByTestId('excluded-note')).toContainText('Excluded from the chart and budgets. Still counted in balances, statements and points.');
  // The line the flag also writes, so the receipt is reading the restored row and not a constant.
  await expect(peekLine(peek, 'Channel')).toContainText('Offline');
});

/**
 * §9 and §2's row-actions table: **a desktop keeps edit in place**, and an edit is still a replacement.
 *
 * The phone gained a sheet in Task 14; the desktop's click-the-row editor is the faster way and was never to be
 * taken away for it. The half nothing asserted is what an edit leaves behind: `replaceTransaction` voids the
 * original and posts a new id, so the row the correction was made from is still on the device — under Show
 * deleted, struck through — and that is the only reason a correction made by mistake can be read back at all.
 */
test('a desktop still edits a row in place, and the original is under Show deleted', async ({ page }) => {
  await addCard(page);
  await spend(page, 'Superindo', '500000');

  // In place is the list an account's own history keeps (a wide screen's Cashflow is the table, Mac Cashflow D).
  await openAccountHistory(page, 'BCA Visa');
  await page.getByRole('button', { name: 'List' }).click();
  // The row's own face, not the ⓘ: on a desktop a click opens `QuickRowEditor` between the rows.
  await page.locator('li', { hasText: 'Superindo' }).click();
  const description = page.getByLabel('Row description');
  await expect(description).toHaveValue('Superindo');
  const amount = page.getByLabel(/^Row amount/);
  await amount.fill('575000');
  await amount.press('Enter');
  await expect(page.getByLabel(/^Row amount/)).toHaveCount(0);

  // One row on the list, carrying the new figure — not two, which is what a correction that posted beside the
  // original rather than replacing it would leave.
  const row = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('575.000');
  // In the database, not only on the screen.
  await page.reload();
  await expect(page.getByTestId('transaction-row').filter({ hasText: 'Superindo' })).toContainText('575.000');

  // And the original is still here to be read: voided, struck through, under Show deleted.
  await page.getByLabel('Show deleted').check();
  const both = page.getByTestId('transaction-row').filter({ hasText: 'Superindo' });
  await expect(both).toHaveCount(2);
  await expect(both.filter({ hasText: '500.000' })).toHaveCount(1);
  await expect(both.filter({ hasText: '575.000' })).toHaveCount(1);
});
