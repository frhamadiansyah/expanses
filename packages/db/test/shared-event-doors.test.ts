import type { CaptureLine } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CheckDecisions,
  categoryIdsByKey,
  convertToPurchase,
  createAccount,
  createCardAccount,
  deleteUnusedAccount,
  EVENT_POSTING_MESSAGE,
  nativeBalances,
  openEventBookTx,
  ownerScope,
  postEventRecordTx,
  prepareStatementCheck,
  recordStatementCheck,
  replaceTransactionTx,
  saveAssetProfile,
  saveCardTerms,
  saveEvent,
  setPaidFromTx,
  upsertRate,
  voidTransactionTx,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { shareBookForTest } from './sync/sync-helpers';

/*
 * Final review C1: a transaction a shared event put on this phone's card is changed only through its record. Any other
 * door (a statement check, a conversion, an account deletion) is refused, or routed to the record, because the next
 * change to the record would otherwise post it again beside the corrected one and charge the card twice.
 *
 * A lira week; Rina's phone. Invented rates: 1 EUR = 17,000 IDR, 1 TRY = 560 IDR; 1 EUR = 31.5 TRY on the record.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

const MAY = { start: '2026-05-11', end: '2026-06-10' };
const NO_DECISIONS: CheckDecisions = { differs: {}, flagged: {}, ask: {}, moveStart: false };
const line = (text: string, x: number, y: number, w = 0.2, h = 0.02): CaptureLine => ({ text, box: [x, y, w, h], height: h });
const image = (rows: [string, string, string][], summary: { previous?: string; closing?: string } = {}): CaptureLine[] => {
  const out = rows.flatMap(([on, description, amount], i) => [line(on, 0.05, 0.1 + i * 0.05, 0.1), line(description, 0.25, 0.1 + i * 0.05, 0.5), line(amount, 0.85, 0.1 + i * 0.05, 0.12)]);
  let y = 0.1 + rows.length * 0.05 + 0.1;
  if (summary.previous) {
    out.push(line('Previous Balance', 0.05, y, 0.3), line(summary.previous, 0.85, y, 0.12));
    y += 0.05;
  }
  if (summary.closing) out.push(line('New Balance', 0.05, y, 0.3), line(summary.closing, 0.85, y, 0.12));
  return out;
};

async function liraWeek(record: { amount: number; currency: string; rate: string; charged: number | null; note?: string; on?: string } = { amount: 9_000, currency: 'EUR', rate: '31.5', charged: 1_530_000 }) {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-05-01', rate, source: 'manual', sourceDate: '2026-05-01' });
  }
  const card = await createCardAccount(t.database, ws, { name: 'Travel card', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  await saveCardTerms(t.database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const other = await createCardAccount(t.database, ws, { name: 'Spare card', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  const eventId = await saveEvent(t.database, ws, { name: 'Lira week', startsOn: '2026-05-14', endsOn: '2026-05-20' });
  await shareBookForTest(t.database, 'ev-book', 'p-rina');
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Lira week', '2026-05-14', '2026-05-20', 'TRY', NULL);
    INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', 'p-rina', 'Rina', 'p-rina', NULL), ('ev-book', 'p-andi', 'Andi', 'p-andi', NULL), ('ev-book', 'p-budi', 'Budi', NULL, NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
  `);
  const trip = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Lira week', currency: 'TRY' }));
  await t.database.execScript(`
    INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at)
      VALUES ('ev-book', 'exp-1', '${record.on ?? '2026-05-15'}', ${record.amount}, '${record.currency}', '${record.rate}', 'p-rina', 'p-rina', NULL);
    INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by)
      VALUES ('ev-book', 'exp-1', ${record.note ? `'${record.note}'` : 'NULL'}, 'cat-dinners', 'equal', '["p-rina","p-andi","p-budi"]', 'p-rina', NULL);
  `);
  await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', 'exp-1', 'expense', { accountId: card.id, amountMinor: record.charged }));
  const derive = (author: string | null = null) => t.database.transaction((tx) => postEventRecordTx(tx, 'ev-book', 'expense', 'exp-1', author));
  await derive();
  const posted = async () => (await t.database.db.values<[string]>(sql`SELECT transaction_id FROM event_postings WHERE book_id = 'ev-book' AND record_id = 'exp-1'`))[0]![0];
  /** A friend's split edit: what makes the next derivation run. */
  const friendEdits = async (people: string[]) => {
    await t.database.execScript(`UPDATE event_expense_details SET split_json = '${JSON.stringify(people)}', updated_by = 'p-andi' WHERE id = 'exp-1'`);
    await derive('p-andi');
  };
  const cardBalance = async () => (await nativeBalances(t.database, ws))[card.id] ?? 0;
  const livePostings = async () => Number((await t.database.db.values<[number]>(sql`SELECT count(*) FROM entries e JOIN transactions x ON x.id = e.transaction_id WHERE e.account_id = ${card.id} AND x.status = 'posted'`))[0]![0]);
  return { ...t, ws, card, other, trip, eventId, derive, posted, friendEdits, cardBalance, livePostings };
}

describe('the ledger’s inner doors on a derived transaction (C1)', () => {
  it('refuse a void or a replace from anyone but the derivation', async () => {
    const t = await liraWeek();
    const id = await t.posted();
    await expect(t.database.transaction((tx) => voidTransactionTx(tx, t.ws, id))).rejects.toMatchObject({ code: 'EVENT_POSTING', message: EVENT_POSTING_MESSAGE });
    await expect(
      t.database.transaction((tx) => replaceTransactionTx(tx, t.ws, id, { occurredOn: '2026-05-15', description: 'x', lines: [{ accountId: t.card.id, amountMinor: -1, currency: 'IDR' }, { accountId: t.trip, amountMinor: 1, currency: 'IDR' }] })),
    ).rejects.toMatchObject({ code: 'EVENT_POSTING' });
    expect(await t.cardBalance()).toBe(-1_530_000);
  });

  it('a replacement made by an older door is followed: the next derivation replaces it, never posts beside it', async () => {
    const t = await liraWeek();
    const id = await t.posted();
    // A copy written before the guard (or a door without it) replaced the derived transaction: 1,540,000 on the card.
    const lines = await t.database.db.values<[string, number, string, string | null]>(sql`SELECT account_id, amount_minor, currency, spend_category_id FROM entries WHERE transaction_id = ${id}`);
    const rates = Object.fromEntries((await t.database.db.values<[string, number]>(sql`SELECT currency, fx_rate_to_base FROM entries WHERE transaction_id = ${id}`)).map(([c, r]) => [c, Number(r)]));
    await t.database.transaction((tx) =>
      replaceTransactionTx(
        tx,
        t.ws,
        id,
        {
          occurredOn: '2026-05-15',
          description: 'Dinners',
          lines: lines.map(([accountId, amountMinor, currency, spendCategoryId]) => ({
            accountId,
            amountMinor: accountId === t.card.id ? -1_540_000 : currency === 'IDR' && Number(amountMinor) > 0 ? Number(amountMinor) + 10_000 : Number(amountMinor),
            currency,
            spendCategoryId,
          })),
          ratesToBase: rates,
        },
        { eventDerivation: true },
      ),
    );
    expect(await t.cardBalance()).toBe(-1_540_000);
    await t.friendEdits(['p-rina', 'p-andi']);
    expect(await t.livePostings()).toBe(1);
    expect(await t.cardBalance()).toBe(-1_530_000);
  });
});

describe('a statement check on a derived card charge (C1)', () => {
  it('“use the statement’s figure” on a euro dinner sets this card’s own figure and re-derives: charged once, also after a friend’s edit', async () => {
    const t = await liraWeek();
    const prepared = await prepareStatementCheck(t.database, t.ws, { cardAccountId: t.card.id, period: MAY, images: [image([['15MAY', 'DINNERS', '1,540,000']], { previous: '0', closing: '1,540,000' })], today: '2026-07-01' });
    const derivedId = await t.posted();
    expect(prepared.rows[0]!.outcome).toMatchObject({ status: 'differs', candidateId: derivedId, statementMinor: 1_540_000 });
    const result = await recordStatementCheck(t.database, t.ws, prepared, { ...NO_DECISIONS, differs: { 0: 'statement' } });
    expect(result.status).toBe('reconciled');
    expect(await t.cardBalance()).toBe(-1_540_000);
    expect(await t.database.db.values(sql`SELECT account_amount_minor FROM event_postings WHERE record_id = 'exp-1'`)).toEqual([[1_540_000]]);
    // Before the fix the derivation found its transaction void and posted again: the card at −3,080,000.
    await t.friendEdits(['p-rina', 'p-andi']);
    expect(await t.livePostings()).toBe(1);
    expect(await t.cardBalance()).toBe(-1_540_000);
  });

  it('refuses “use the statement’s figure” on an expense in the card’s own currency: that figure is the record’s', async () => {
    const t = await liraWeek({ amount: 1_530_000, currency: 'IDR', rate: '0.0018', charged: null });
    const prepared = await prepareStatementCheck(t.database, t.ws, { cardAccountId: t.card.id, period: MAY, images: [image([['15MAY', 'DINNERS', '1,540,000']], { previous: '0', closing: '1,540,000' })], today: '2026-07-01' });
    expect(prepared.rows[0]!.outcome).toMatchObject({ status: 'differs' });
    await expect(recordStatementCheck(t.database, t.ws, prepared, { ...NO_DECISIONS, differs: { 0: 'statement' } })).rejects.toMatchObject({
      code: 'EVENT_POSTING',
      message: '“Dinners” follows a shared event’s record. Change it on the event.',
    });
    await t.friendEdits(['p-rina', 'p-andi']);
    expect(await t.cardBalance()).toBe(-1_530_000);
  });

  it('refuses “not on this card” (delete or move) on a derived charge; nothing changes and a later edit charges once', async () => {
    const t = await liraWeek();
    const prepared = await prepareStatementCheck(t.database, t.ws, { cardAccountId: t.card.id, period: MAY, images: [image([['20MAY', 'KEDAI LAIN', '10,000']], { previous: '0' })], today: '2026-07-01' });
    const derivedId = await t.posted();
    expect(prepared.flagged.map((f) => f.transactionId)).toContain(derivedId);
    const groceries = (await categoryIdsByKey(t.database, t.ws))['household.groceries']!;
    const rows = prepared.rows.map((r) => (r.categoryId === null ? { ...r, categoryId: groceries, categorySource: 'owner' as const } : r));
    for (const answer of ['delete', { moveTo: t.other.id }] as const) {
      await expect(recordStatementCheck(t.database, t.ws, { ...prepared, rows }, { ...NO_DECISIONS, flagged: { [derivedId]: answer } })).rejects.toMatchObject({ code: 'EVENT_POSTING' });
    }
    expect(await t.posted()).toBe(derivedId);
    await t.friendEdits(['p-rina', 'p-andi']);
    expect(await t.livePostings()).toBe(1);
    expect(await t.cardBalance()).toBe(-1_530_000);
  });
});

describe('other doors on a derived transaction (C1)', () => {
  it('convert to a purchase is refused; the card stays charged once', async () => {
    const t = await liraWeek();
    const gold = await createAccount(t.database, t.ws, { name: 'Gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(t.database, t.ws, { accountId: gold.id, assetKind: 'gold' });
    await expect(convertToPurchase(t.database, t.ws, { transactionId: await t.posted(), accountId: gold.id, unitsMicro: 1_000_000 })).rejects.toMatchObject({ code: 'EVENT_POSTING', message: EVENT_POSTING_MESSAGE });
    await t.friendEdits(['p-rina', 'p-andi']);
    expect(await t.livePostings()).toBe(1);
    expect(await t.cardBalance()).toBe(-1_530_000);
  });

  it('deleting the account a derived payment is the only entry of is refused', async () => {
    const t = await liraWeek();
    // A spare card whose only entry is a derived payment written as its opening (a note that reads like one).
    const spare = await createAccount(t.database, t.ws, { name: 'Pocket', kind: 'asset', subtype: 'cash', currency: 'IDR' });
    await t.database.execScript(`UPDATE event_expense_details SET note = 'Opening balance: Pocket' WHERE id = 'exp-1'`);
    await t.database.transaction((tx) => setPaidFromTx(tx, 'ev-book', 'exp-1', 'expense', { accountId: spare.id, amountMinor: 1_530_000 }));
    await t.derive();
    await expect(deleteUnusedAccount(t.database, t.ws, spare.id)).rejects.toMatchObject({ code: 'EVENT_POSTING' });
    expect((await nativeBalances(t.database, t.ws))[spare.id]).toBe(-1_530_000);
  });
});
