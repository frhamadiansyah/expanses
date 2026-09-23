import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openAccount, openCard } from './accounts';
import BetterSqlite3 from 'better-sqlite3';
import { openNewAsset } from './add-asset';
import { addTransaction, closeDetails, shareWith } from './add-transaction';

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

/** The receipt behind a row's ⓘ, which is the only way a desktop reaches one. */
async function openReceipt(page: Page, description: string) {
  await page.goto('/transactions');
  await page.getByRole('link', { name: `Receipt for ${description}` }).click();
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
}

/**
 * The receipt, reached the way a desktop reaches it: the ⓘ at the end of the row.
 *
 * Task 17 grows this file into the full desktop pass. It exists from here so that task modifies a file that is
 * already there, rather than inventing one beside it.
 */
test('the ⓘ on a row opens the receipt, and the row itself still edits in place', async ({ page }) => {
  await openCard(page, { name: 'BCA Visa' });

  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: 'BCA Visa', category: 'Groceries', amount: '500000' });
  await expect(page.getByText('Superindo')).toBeVisible();

  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();

  // Its own route, so it can be linked to, bookmarked and reached by URL — not a panel on the list.
  await expect(page).toHaveURL(/\/transactions\/[0-9a-zA-Z-]{20,}$/);
  await expect(page.getByRole('heading', { name: 'Superindo' })).toBeVisible();

  // The figure, not the word: what the card was charged, beside the account that was charged.
  const paidWith = page.locator('div', { hasText: /^Paid with/ }).last();
  await expect(paidWith).toContainText('BCA Visa');
  const total = page.locator('div', { hasText: /^Total/ }).last();
  await expect(total).toContainText('500.000');
  await expect(page.getByTestId('receipt-hero')).toContainText('500.000');

  // Back lands where it came from, and the row's own click still opens the in-place editor: the ⓘ is a way in
  // beside editing, never instead of it.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await page.locator('li', { hasText: 'Superindo' }).click();
  await expect(page.getByLabel('Row description')).toHaveValue('Superindo');
});

/**
 * The refusals the receipt has to inherit, because it is a new way into a transaction and not a new set of
 * rules about one.
 *
 * `TransactionsPage` and `TransactionsTable` both replace a trade row's whole trailing slot with **Buy & sell**:
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

  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();

  await page.goto('/transactions');
  await page.getByRole('button', { name: 'Add transaction' }).click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' });
  await form.getByRole('radio', { name: 'Buy / sell' }).click();
  await form.getByLabel('Grams').fill('2');
  await form.getByLabel(/What it cost, before fees/).fill('3980000');
  await form.getByLabel('Paid with').first().selectOption({ label: 'BCA Tahapan (IDR)' });
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form).toHaveCount(0);
  await expect(page.getByText('Bought 2 Antam gold bars')).toBeVisible();

  // Cash down 3,98 M, gold up 3,98 M: buying something changes nothing about what you are worth.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');

  await openReceipt(page, 'Bought 2 Antam gold bars');
  await expect(page.getByRole('link', { name: 'Buy & sell' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Click again to delete' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toHaveCount(0);

  // And nothing about opening the receipt moved the money.
  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('68.600.000');

  await openReceipt(page, 'Opening balance: BCA Tahapan');
  await expect(page.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit this transaction' })).toHaveCount(0);
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
  await openReceipt(page, 'Superindo');
  const receiptUrl = page.url();

  await page.getByRole('button', { name: 'Delete this transaction' }).click();
  // Armed, not gone: one press never deletes, and the receipt is still the receipt.
  await expect(page).toHaveURL(receiptUrl);
  await expect(page.getByTestId('receipt-hero')).toContainText('500.000');

  await page.getByRole('button', { name: 'Click again to delete' }).click();
  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(page.getByText('Superindo')).toHaveCount(0);

  // Deleted, not destroyed: it reads as deleted, and offers no second way to delete it again.
  await page.getByLabel('Show deleted').check();
  await page.getByRole('link', { name: 'Receipt for Superindo' }).click();
  await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
  await expect(page.getByTestId('hero-amount')).toHaveClass(/line-through/);
  await expect(page.getByRole('button', { name: 'Delete this transaction' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
});

/**
 * An edit replaces the transaction — the original is voided and a new one posted under a new id — so the
 * receipt the edit was made from no longer names anything. It lands on the list rather than sitting on a
 * page that is now about a deleted row.
 */
test('an edit from the receipt lands on the list, because the edit replaces the transaction', async ({ page }) => {
  await addCard(page);
  await spend(page, 'Superindo', '500000');
  await openReceipt(page, 'Superindo');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit transaction' })).toBeVisible();
  await page.getByLabel('Amount', { exact: true }).fill('575000');
  await page.getByRole('button', { name: 'Save' }).click();

  await expect(page).toHaveURL(/\/transactions(\?|$)/);
  await expect(page.locator('li', { hasText: 'Superindo' }).last()).toContainText('575.000');
});

/** The purchase a receipt can still turn into a holding, which is the third of the three actions it offers. */
test('a purchase becomes a holding from the receipt', async ({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
  await openAccount(page, { subtype: 'bank', name: 'BCA Tahapan', balance: '50000000' });

  await openNewAsset(page, 'Gold bullion');
  await page.getByLabel('Name', { exact: true }).fill('Antam gold bars');
  await page.getByLabel('Bought on').fill('2026-03-09');
  await page.getByLabel('How much').fill('10');
  await page.getByLabel('Total cost (IDR)').fill('18600000');
  await page.getByRole('button', { name: 'Add asset' }).last().click();
  await expect(page.getByRole('link', { name: /Antam gold bars/ })).toBeVisible();

  await page.goto('/transactions');
  await addTransaction(page, { description: 'UBS Gold Store', paidWith: 'BCA Tahapan', category: 'Shopping', amount: '3980000' });
  await expect(page.getByText('UBS Gold Store')).toBeVisible();

  await openReceipt(page, 'UBS Gold Store');
  await page.getByRole('button', { name: 'This was a purchase' }).click();
  await expect(page.getByRole('dialog', { name: 'This was a purchase' })).toBeVisible();
  await page.getByLabel('Units, shares or grams').fill('2');
  await page.getByRole('button', { name: 'Save as a purchase' }).click();
  // The sheet closes on success only, so waiting for it to go is waiting for the write to land.
  await expect(page.getByRole('dialog', { name: 'This was a purchase' })).toBeHidden();

  await page.goto('/net-worth/trades');
  await expect(page.getByText('12 g').first()).toBeVisible();
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
  await page.getByRole('dialog', { name: 'Paid with' }).getByRole('button', { name: 'BCA Visa', exact: true }).click();
  await split.getByLabel('Amount', { exact: true }).fill('400000');
  await split.getByRole('button', { name: 'Category' }).click();
  await page.getByRole('dialog', { name: 'Select category' }).getByRole('button', { name: 'Groceries', exact: true }).click();
  await split.getByLabel('Note').fill('Dinner at Plataran');
  const { more, sheet } = await shareWith(page, split, [{ name: 'Andi', owes: '300000' }]);
  await closeDetails(more, sheet);
  await split.getByRole('button', { name: 'Save' }).click();
  await expect(split).toHaveCount(0);
  await expect(page.getByText('Dinner at Plataran')).toBeVisible();

  await openReceipt(page, 'Dinner at Plataran');
  const hero = page.getByTestId('receipt-hero');
  await expect(hero).toContainText('100.000');
  await expect(hero).toContainText('Your share');
  await expect(page.locator('div', { hasText: /^Total/ }).last()).toContainText('400.000');
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

  await openReceipt(page, 'Superindo');
  await expect(page.getByTestId('excluded-note')).toContainText('Excluded from the chart and budgets. Still counted in balances, statements and points.');
  // The line the flag also writes, so the receipt is reading the restored row and not a constant.
  await expect(page.locator('div', { hasText: /^Channel/ }).last()).toContainText('Offline');
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

  await page.goto('/transactions');
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
