import {
  type CoretaxRowPart,
  type ItemSummary,
  type ItemTax,
  lastMonthEnds,
  type PeriodMovement,
  splitPeriod,
  statementCycleFor,
  calendarCycleFor,
  summaryHash,
} from '@expanses/core';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../context';
import type { Database, Db } from '../../database';
import { assetValueSeries } from '../../repos/asset-values';
import { BALANCE_SUBTYPES } from '../../repos/accounts';
import { activeNetWorthGroup, markHeldTx, outsiderDevices, sendAllowance } from '../../repos/net-worth-sharing';
import { taxRowFor } from '../../repos/tax-inputs';
import { withCapture } from '../capture';
import { uuidv5 } from '../uuidv5';

/*
 * Summaries — compute, send, receive (joint-net-worth spec §5.2, §9, §10; task 6).
 *
 * An item is one of this device's own asset or liability accounts (never a member's placeholder, never a pocket parent,
 * never archived). Its summary is computed here, on its owner's phone, from the local ledger, and written as this
 * member's own `nw_items` row in the group log, captured: the op carries the summary alone — a balance, a chart of
 * month-ends, the Household lines' total and ONE other-use total — never a private line's amount, description or id,
 * and never a local account id (the item is known by `itemIdOf`, a one-way name the owner's phone keeps in
 * `nw_item_map`).
 *
 * When one is sent (§9): the member is in an active group, the item's share setting is `total` (absent = not reviewed =
 * nothing), and its summary differs from the one last sent (`nw_sent`). An item that stops being shared — set to
 * hidden, archived, deleted — sends `removed = true` with its summary blanked, so every other phone drops it and its
 * history. Capture calls `sendSummariesTx` at flush for every account a transaction touched; Share (task 5) and a
 * restored phone's rejoin call it for `'all'`.
 */

/** The device's local date (YYYY-MM-DD) at `ms`: an item's summary is as of its owner's day (§5.2 `asOf`). */
export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Joint-net-worth §5.1: `itemId = uuidv5(groupBookId, 'item:' + accountId)` — one-way, so peers never learn the account id. */
export function itemIdOf(groupBookId: string, accountId: string): Promise<string> {
  return uuidv5(groupBookId, `item:${accountId}`);
}

/** An item's share setting (§5.4): `total`, `hidden`, or null — not reviewed yet, which sends nothing. */
async function shareSettingOf(tx: Db, accountId: string): Promise<'total' | 'hidden' | null> {
  const [row] = await tx.values<[string]>(sql`SELECT setting FROM nw_share_settings WHERE account_id = ${accountId}`);
  return row?.[0] === 'total' || row?.[0] === 'hidden' ? row[0] : null;
}

interface AccountRow {
  id: string;
  kind: string;
  subtype: string;
  name: string;
  currency: string | null;
  archivedAt: string | null;
}

async function accountOf(tx: Db, workspaceId: string, accountId: string): Promise<AccountRow | null> {
  const [row] = await tx.values<[string, string, string, string, string | null, string | null]>(
    sql`SELECT id, kind, subtype, name, currency, archived_at FROM accounts WHERE id = ${accountId} AND workspace_id = ${workspaceId}`,
  );
  return row ? { id: row[0], kind: row[1], subtype: row[2], name: row[3], currency: row[4], archivedAt: row[5] } : null;
}

/** Whether an account is an item at all (§5.2): an open asset or liability of the balance sheet, not a placeholder or a pocket parent. */
async function isItem(tx: Db, account: AccountRow | null): Promise<boolean> {
  if (!account || account.archivedAt !== null) return false;
  if (account.kind !== 'asset' && account.kind !== 'liability') return false;
  if (!(BALANCE_SUBTYPES[account.kind] as readonly string[]).includes(account.subtype)) return false;
  if ((await tx.values(sql`SELECT 1 FROM book_member_accounts WHERE account_id = ${account.id}`)).length > 0) return false;
  if ((await tx.values(sql`SELECT 1 FROM accounts WHERE parent_id = ${account.id} AND kind = 'asset' LIMIT 1`)).length > 0) return false;
  return true;
}

const dayBefore = (date: string): string => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/** A read-only `Database` over a running transaction, for the repository reads that take one (never `transaction`). */
function readView(tx: Db): Database {
  return {
    db: tx,
    transaction: () => Promise.reject(new Error('summaries: read-only view of a running transaction')),
    execScript: () => Promise.reject(new Error('summaries: read-only view')),
    exportBytes: () => Promise.reject(new Error('summaries: read-only view')),
    importBytes: () => Promise.reject(new Error('summaries: read-only view')),
  };
}

/**
 * One item's summary (§5.2), on its owner's phone, from the local ledger.
 * - Balance sense: what an asset holds, what a liability owes (the ledger's debit-positive sum, negated for a liability).
 * - Period: a card's statement cycle containing `today` (`statementCycleFor`, as `cycleFor` with a statement anchor),
 *   else the calendar month of `today`. Movements count from the period's start up to `today`.
 * - Household: an entry whose transaction is filed in the workspace's book (`book_transactions.book_id`). Everything
 *   else is other use, summed into one figure. A valued asset's value change beyond its ledger movements (a new price,
 *   a new estimate) is other use too, so `openingMinor + householdMinor + otherUseMinor = balanceMinor` always holds.
 * - `monthEnds`: the value at each of the last 24 month-ends (`lastMonthEnds`), for the chart and year-end.
 */
export async function computeItemSummary(tx: Db, ws: WorkspaceContext, accountId: string, owner: string, workspaceBookId: string, today: string): Promise<ItemSummary> {
  const account = await accountOf(tx, ws.workspaceId, accountId);
  if (!account || (account.kind !== 'asset' && account.kind !== 'liability')) throw new Error(`summaries: ${accountId} is not an item`);
  const kind = account.kind;
  const sign = kind === 'liability' ? -1 : 1;
  const currency = account.currency ?? ws.baseCurrency;

  const [terms] =
    account.subtype === 'credit_card'
      ? await tx.values<[number | null, number]>(sql`SELECT credit_limit_minor, statement_day FROM card_terms WHERE account_id = ${accountId}`)
      : [];
  const cycle = terms ? statementCycleFor(today, Number(terms[1])) : null;
  const period = cycle ?? calendarCycleFor(today);
  const card = terms && cycle ? { limitMinor: Number(terms[0] ?? 0), cycleStart: cycle.start, cycleEnd: cycle.end } : null;

  // Every posted entry on the account, once: dated, signed in the item's sense, and whether it is a Household line.
  const lines = (
    await tx.values<[string, string, number, number]>(sql`
      SELECT t.id, t.occurred_on, e.amount_minor,
             EXISTS (SELECT 1 FROM book_transactions bt WHERE bt.transaction_id = t.id AND bt.book_id = ${workspaceBookId})
      FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${accountId} AND t.status = 'posted'
      ORDER BY t.occurred_on, e.rowid`)
  ).map(([transactionId, occurredOn, amountMinor, household]) => ({ transactionId, occurredOn, amountMinor: sign * Number(amountMinor), household: Number(household) !== 0 }));
  const ledgerAt = (date: string) => lines.reduce((sum, line) => (line.occurredOn <= date ? sum + line.amountMinor : sum), 0);

  // An asset is worth what the Net worth reader says (a price, an estimate, or its ledger balance), its inputs read
  // once for every date; a liability owes its ledger balance.
  const months = lastMonthEnds(today, 24);
  const dates = [today, dayBefore(period.start), ...months.map(monthEnd)];
  const series = kind === 'asset' ? await assetValueSeries(readView(tx), ws, accountId, dates, ledgerAt) : null;
  const values = series ?? dates.map(ledgerAt);
  const [balanceMinor, openingMinor] = values as [number, number];
  const movements: PeriodMovement[] = lines
    .filter((line) => line.occurredOn >= period.start && line.occurredOn <= today)
    .map(({ transactionId, amountMinor, household }) => ({ transactionId, amountMinor, household }));
  const split = splitPeriod(openingMinor, movements);
  const monthEnds: ItemSummary['monthEnds'] = months.map((month, i) => ({ month, balanceMinor: values[i + 2]! }));

  const [primary] = await tx.values<[string | null]>(
    sql`SELECT last4 FROM cards WHERE account_id = ${accountId} AND archived_at IS NULL AND last4 IS NOT NULL ORDER BY is_primary DESC, created_at LIMIT 1`,
  );
  return {
    owner,
    kind,
    subtype: account.subtype,
    name: primary?.[0] ? `${account.name} ···· ${primary[0]}` : account.name,
    currency,
    balanceMinor,
    asOf: today,
    card,
    period: { start: period.start, end: period.end },
    openingMinor,
    householdMinor: split.householdMinor,
    // Anything the ledger lines do not explain (a valued asset's new price) is other use, so the parts add up.
    otherUseMinor: split.otherUseMinor + (balanceMinor - split.closingMinor),
    monthEnds,
    tax: await itemTaxOf(tx, ws, accountId, workspaceBookId, today),
  };
}

/**
 * The item's `tax` (§5.2, §8.4; task 10): only while the one active group this person is in files with one tax ID and
 * lives in this workspace, the item's slice of `coretaxInputsFor` for the latest finished tax year (today's year − 1).
 * Each row is known by the item's id instead of the local account id, and a foreign holding's `purchases` (each buy, a
 * private line's amount and date) stay behind: the report's note under that row is its owner's alone. An item that files
 * nothing that year carries an empty slice, so it is never mistaken for one still waiting.
 */
async function itemTaxOf(tx: Db, ws: WorkspaceContext, accountId: string, workspaceBookId: string, today: string): Promise<ItemTax> {
  const group = await activeNetWorthGroup(tx);
  if (!group || group.mode !== 'joint' || group.workspaceBookId !== workspaceBookId) return null;
  const taxYear = Number(today.slice(0, 4)) - 1;
  const itemId = await itemIdOf(group.groupBookId, accountId);
  const found = await taxRowFor(readView(tx), ws, accountId, taxYear);
  const part: CoretaxRowPart = {
    cash: (found?.cash ?? []).map((row) => ({ ...row, accountId: itemId })),
    holdings: (found?.holdings ?? []).map(({ purchases: _purchases, ...row }) => ({ ...row, accountId: itemId })),
    estimated: (found?.estimated ?? []).map((row) => ({ ...row, accountId: itemId })),
    receivables: (found?.receivables ?? []).map((row) => ({ ...row, accountId: itemId })),
    debts: (found?.debts ?? []).map((row) => ({ ...row, accountId: itemId })),
  };
  return { taxYear, part };
}

/** The workspace (its id and currency) a shared book lives in on this device. */
async function workspaceOfBook(tx: Db, bookId: string): Promise<WorkspaceContext | null> {
  const [row] = await tx.values<[string, string]>(
    sql`SELECT w.id, w.base_currency FROM books b JOIN workspaces w ON w.id = b.workspace_id WHERE b.id = ${bookId}`,
  );
  return row ? { workspaceId: row[0], baseCurrency: row[1] } : null;
}

/** Writes this member's own item row in the group log, captured: the op the group's other phones receive. */
async function writeItemTx(tx: Db, groupBookId: string, itemId: string, owner: string, summaryJson: string, removed: boolean): Promise<void> {
  await withCapture(tx, { entity: 'nw_item', id: itemId, bookId: groupBookId }, async () => {
    await tx.run(sql`
      INSERT INTO nw_items (book_id, item_id, owner, summary_json, removed) VALUES (${groupBookId}, ${itemId}, ${owner}, ${summaryJson}, ${removed ? 1 : 0})
      ON CONFLICT (book_id, item_id) DO UPDATE SET summary_json = excluded.summary_json, removed = excluded.removed`);
  });
}

/**
 * Sends the summaries of `accountIds` (or of every item, `'all'`) that changed, into the group log of the one active group
 * this member is in (§4): a new or changed summary for an item shared `total`; `removed = true` (summary blanked) for one this
 * member had shared that is now hidden, archived, deleted or no item at all; nothing for the rest. Inside the caller's
 * transaction, captured, so the ops leave with the next sync. Returns how many items it wrote.
 */
export async function sendSummariesTx(tx: Db, accountIds: readonly string[] | 'all', today: string): Promise<number> {
  // One group per person (§4): the one active group this member is in, read by the one group-state reader (task 5).
  const group = await activeNetWorthGroup(tx);
  if (!group) return 0;
  // Nothing new before this person's own review of this activation, except the refresh of a live item when nobody was
  // added (§6 Review, wave 3 merge review round 1). A removal is never held back: it only takes away (round 2).
  const allowance = await sendAllowance(tx, group);
  const { groupBookId, workspaceBookId, me: memberId } = group;
  // Held while an outsider is still in the log (round 4): the group log's sync sends every item once they are out.
  if (allowance === 'none' && (await outsiderDevices(tx, groupBookId, group.members)).length > 0) await markHeldTx(tx, groupBookId);
  const ws = await workspaceOfBook(tx, workspaceBookId);
  if (!ws) return 0;
  let written = 0;
  const ids = new Set<string>();
  if (accountIds === 'all') {
    for (const [id] of await tx.values<[string]>(sql`SELECT id FROM accounts WHERE workspace_id = ${ws.workspaceId} AND kind IN ('asset', 'liability') ORDER BY id`)) ids.add(id);
    for (const [id] of await tx.values<[string]>(sql`SELECT account_id FROM nw_item_map WHERE group_book_id = ${groupBookId}`)) ids.add(id);
  } else for (const id of accountIds) ids.add(id);

  for (const accountId of ids) {
    const itemId = await itemIdOf(groupBookId, accountId);
    const account = await accountOf(tx, ws.workspaceId, accountId);
    const shared = (await isItem(tx, account)) && (await shareSettingOf(tx, accountId)) === 'total';
    if (shared && allowance === 'none') continue; // a shared item waits for the Share; removals below always go
    if (shared) {
      const summary = await computeItemSummary(tx, ws, accountId, memberId, workspaceBookId, today);
      const hash = summaryHash(summary);
      const [sent] = await tx.values<[string]>(sql`SELECT summary_hash FROM nw_sent WHERE item_id = ${itemId}`);
      const [live] = await tx.values<[number]>(sql`SELECT removed FROM nw_items WHERE book_id = ${groupBookId} AND item_id = ${itemId}`);
      if (sent?.[0] === hash && live && Number(live[0]) === 0) continue;
      if (allowance === 'live' && !(live && Number(live[0]) === 0)) continue; // a new item waits for the Share
      await tx.run(sql`
        INSERT INTO nw_item_map (account_id, group_book_id, item_id) VALUES (${accountId}, ${groupBookId}, ${itemId})
        ON CONFLICT (account_id) DO UPDATE SET group_book_id = excluded.group_book_id, item_id = excluded.item_id`);
      await writeItemTx(tx, groupBookId, itemId, memberId, JSON.stringify(summary), false);
      await tx.run(sql`INSERT INTO nw_sent (item_id, summary_hash) VALUES (${itemId}, ${hash}) ON CONFLICT (item_id) DO UPDATE SET summary_hash = excluded.summary_hash`);
      written += 1;
      continue;
    }
    // Not shared (any more): an item this member had shared, still live in the log, is taken back.
    await tx.run(sql`DELETE FROM nw_sent WHERE item_id = ${itemId}`);
    const [live] = await tx.values<[string, number]>(sql`SELECT owner, removed FROM nw_items WHERE book_id = ${groupBookId} AND item_id = ${itemId}`);
    if (!live || live[0] !== memberId || Number(live[1]) !== 0) continue;
    await writeItemTx(tx, groupBookId, itemId, memberId, 'null', true);
    written += 1;
  }
  return written;
}

/** The items other members share with this device's group (§8.2, §8.3): live ones only, never this member's own. */
export async function receivedItems(database: Database, groupBookId: string): Promise<(ItemSummary & { itemId: string })[]> {
  const [self] = await database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${groupBookId}`);
  if (!self) return [];
  const rows = await database.db.values<[string, string, string]>(
    sql`SELECT item_id, owner, summary_json FROM nw_items WHERE book_id = ${groupBookId} AND removed = 0 AND owner <> ${self[0]} ORDER BY owner, item_id`,
  );
  const out: (ItemSummary & { itemId: string })[] = [];
  for (const [itemId, owner, json] of rows) {
    try {
      const summary = JSON.parse(json) as ItemSummary | null;
      // The owner is the row's, which the writer rule vouches for; never what the summary's own text claims.
      if (summary && typeof summary === 'object') out.push({ ...summary, owner, itemId });
    } catch {
      // A summary that does not parse is shown as nothing, not as a wrong number.
    }
  }
  return out;
}

/**
 * What the engine sends after a sync (task 6 review round 1): the items apply changed (a peer's edit or void of a
 * Household line on one of this device's accounts, `pending`), and every item whose summary is for a period that has
 * ended (§5.2: the period is today's cycle or month). The hash skip keeps an unchanged one from going out.
 */
export async function refreshSummariesTx(tx: Db, pending: readonly string[], today: string): Promise<number> {
  const ids = new Set(pending);
  let own: [string, string][] = [];
  try {
    own = await tx.values<[string, string]>(sql`
      SELECT m.account_id, i.summary_json FROM nw_items i
      JOIN nw_item_map m ON m.item_id = i.item_id AND m.group_book_id = i.book_id
      JOIN shared_books s ON s.book_id = i.book_id AND s.member_id = i.owner
      WHERE i.removed = 0 AND s.state = 'active'`);
  } catch {
    return 0; // a database from before migration 0057
  }
  for (const [accountId, json] of own) {
    try {
      const summary = JSON.parse(json) as Pick<ItemSummary, 'period'> | null;
      if (!summary?.period || summary.period.end < today) ids.add(accountId);
    } catch {
      ids.add(accountId);
    }
  }
  return ids.size === 0 ? 0 : sendSummariesTx(tx, [...ids], today);
}

