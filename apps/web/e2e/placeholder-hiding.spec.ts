import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import BetterSqlite3 from 'better-sqlite3';
import { openAccount } from './accounts';
import { addTransaction } from './add-transaction';
import { openDrawers } from './drawers';

/*
 * Household sharing spec §4.4: a placeholder is one `accounts` row per other member, per book and per currency,
 * that a device posts the money side of another member's purchase against. It must never read as the user's own
 * money — never on the Accounts page, Net worth, a Paid-with picker, the tax report or the health ratios.
 *
 * Nothing in this build's UI creates `book_member_accounts` yet — the invite and capture/apply flow that would
 * write one is built in a parallel lane — so the row is planted the way `transaction-receipt.spec.ts` plants a
 * `transaction_flags` row nothing in the UI sets yet: a real backup is downloaded, a row is written into it with
 * SQLite directly, and it is restored through the app's own Restore door. A row written by SQLite is the same row
 * either way.
 */

const YEAR = new Date().getFullYear();

test.beforeEach(({ page }) => {
  page.on('dialog', (dialog) => void dialog.accept());
});

/** The name the placeholder account is planted under — Alex, the other member the purchase was paid by. */
const PLACEHOLDER_NAME = 'Alex';
const ORDINARY_NAME = 'BCA Tahapan';

/**
 * Downloads the running app's backup, writes a placeholder account and its `book_member_accounts` row into a copy
 * of it with SQLite directly, and restores that copy — so the device now holds exactly what it held before, plus
 * one hidden placeholder account with a real balance in it.
 */
async function plantPlaceholder(page: Page, testInfoOutputDir: string) {
  await page.goto('/backup');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download backup' }).click();
  const source = join(testInfoOutputDir, 'plain.sqlite3');
  mkdirSync(dirname(source), { recursive: true });
  writeFileSync(source, readFileSync((await (await downloaded).path())!));

  const planted = join(testInfoOutputDir, 'planted.sqlite3');
  writeFileSync(planted, readFileSync(source));
  const db = new BetterSqlite3(planted);
  try {
    const ws = db.prepare('SELECT id FROM workspaces LIMIT 1').get() as { id: string };
    const equity = db.prepare("SELECT id FROM accounts WHERE workspace_id = ? AND system_key = 'opening_balance'").get(ws.id) as { id: string };

    const accountId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO accounts (id, workspace_id, parent_id, kind, subtype, name, icon, currency, valuation_mode, system_key, sort_order, archived_at, created_at)
       VALUES (?, ?, NULL, 'asset', 'cash', ?, NULL, 'IDR', 'derived', NULL, 0, NULL, ?)`,
    ).run(accountId, ws.id, PLACEHOLDER_NAME, now);

    db.prepare(
      `INSERT INTO book_member_accounts (account_id, book_id, member_id, currency) VALUES (?, 'book-1', 'member-alex', 'IDR')`,
    ).run(accountId);

    // A real balance, large enough that Net worth and the tax report would visibly move if it were ever counted:
    // 90,000,000 IDR, posted as an opening balance against the workspace's own equity account.
    const txId = randomUUID();
    db.prepare(
      `INSERT INTO transactions (id, workspace_id, occurred_on, description, source, status, created_at)
       VALUES (?, ?, ?, 'Opening balance: Alex', 'manual', 'posted', ?)`,
    ).run(txId, ws.id, `${YEAR}-01-01`, now);
    const assetEntryId = randomUUID();
    const equityEntryId = randomUUID();
    db.prepare(
      `INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
       VALUES (?, ?, ?, ?, 90000000, 'IDR', 1, 90000000)`,
    ).run(assetEntryId, ws.id, txId, accountId);
    db.prepare(
      `INSERT INTO entries (id, workspace_id, transaction_id, account_id, amount_minor, currency, fx_rate_to_base, amount_base_minor)
       VALUES (?, ?, ?, ?, -90000000, 'IDR', 1, -90000000)`,
    ).run(equityEntryId, ws.id, txId, equity.id);
  } finally {
    db.close();
  }

  await page.goto('/backup');
  const safety = page.waitForEvent('download');
  await page.locator('input[accept*="sqlite3"]').setInputFiles(planted);
  await safety;
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Replace my data with/ }).click()]);
  await expect(page.getByRole('heading', { name: 'Backup', exact: true })).toBeVisible();
}

test('the Accounts page never lists a placeholder account', async ({ page }, testInfo) => {
  await openAccount(page, { subtype: 'bank', name: ORDINARY_NAME, balance: '20000000' });
  await plantPlaceholder(page, testInfo.outputDir);

  await page.goto('/accounts');
  // One type of money account is on this device (Current account), so the list draws flat with no drawer to
  // open — the placeholder, filtered out at the reader, never becomes a second type asking for one.
  await expect(page.getByRole('link', { name: ORDINARY_NAME, exact: true })).toBeVisible();
  await expect(page.getByText(PLACEHOLDER_NAME)).toHaveCount(0);
});

test('Net worth never counts or names a placeholder account', async ({ page }, testInfo) => {
  await openAccount(page, { subtype: 'bank', name: ORDINARY_NAME, balance: '20000000' });

  await page.goto('/net-worth');
  await expect(page.getByTestId('net-worth')).toContainText('20.000.000');

  await plantPlaceholder(page, testInfo.outputDir);

  await page.goto('/net-worth');
  // Rp 90.000.000 sitting in the placeholder never joins the total: it reads exactly as it did before.
  await expect(page.getByTestId('net-worth')).toContainText('20.000.000');
  await openDrawers(page);
  await expect(page.getByText(ORDINARY_NAME)).toBeVisible();
  await expect(page.getByText(PLACEHOLDER_NAME)).toHaveCount(0);
});

test('the Paid-with picker on the add form never offers a placeholder account', async ({ page }, testInfo) => {
  await openAccount(page, { subtype: 'bank', name: ORDINARY_NAME, balance: '20000000' });
  await plantPlaceholder(page, testInfo.outputDir);

  await page.goto('/transactions');
  await page.getByRole('button', { name: /^Add (a )?transaction$/ }).first().click();
  const form = page.getByRole('dialog', { name: 'Add a transaction' }).or(page.getByRole('form', { name: 'Add a transaction' }));
  await form.getByRole('button', { name: /^(Paid with|Received into)/ }).click();
  const sheet = page.getByRole('dialog', { name: /^(Paid with|Received into)$/ });
  await expect(sheet.getByRole('button', { name: ORDINARY_NAME, exact: true })).toBeVisible();
  await expect(sheet.getByRole('button', { name: PLACEHOLDER_NAME, exact: true })).toHaveCount(0);
});

test('the tax report never lists a placeholder account in Kas dan Setara Kas', async ({ page }, testInfo) => {
  await openAccount(page, { subtype: 'bank', name: ORDINARY_NAME, balance: '20000000', opened: `${YEAR}-01-02` });
  await plantPlaceholder(page, testInfo.outputDir);

  await page.goto('/tax-report');
  await page.getByLabel('Tax year').selectOption(String(YEAR));
  await page.getByRole('button', { name: `Start the ${YEAR} report` }).click();
  await expect(page.getByText('Ikhtisar')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Kas dan Setara Kas' })).toBeVisible();
  await expect(page.getByText(ORDINARY_NAME).first()).toBeVisible();
  await expect(page.getByText(PLACEHOLDER_NAME)).toHaveCount(0);
});

test('the health ratios never count a placeholder account as cash', async ({ page }, testInfo) => {
  await openAccount(page, { subtype: 'bank', name: ORDINARY_NAME, balance: '20000000' });
  await page.goto('/transactions');
  await addTransaction(page, { description: 'Superindo', paidWith: ORDINARY_NAME, category: 'Groceries', amount: '4000000' });

  await page.goto('/net-worth/health');
  const card = page.locator('section', { has: page.getByRole('heading', { name: 'Emergency fund', exact: true }) }).last();
  await expect(card).toContainText('4,0 months');

  await plantPlaceholder(page, testInfo.outputDir);

  // Rp 90.000.000 more cash would turn 4,0 months into more than 20 if it were ever counted; the figure holds.
  await page.goto('/net-worth/health');
  await expect(card).toContainText('4,0 months');
});
