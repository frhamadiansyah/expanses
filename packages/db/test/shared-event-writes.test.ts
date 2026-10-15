import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addEventPerson,
  archiveEventCategory,
  createAccount,
  editSharedExpense,
  finishSharedEvent,
  nativeBalances,
  openEventBookTx,
  ownerScope,
  recordSettlement,
  recordSharedExpense,
  removeEventPerson,
  renameEventPerson,
  saveEvent,
  saveEventCategory,
  sharedEventOf,
  setSharedEventCurrency,
  takeOverRecords,
  upsertRate,
  voidSettlement,
  voidSharedExpense,
  type SharedExpenseInput,
} from '../src/index';
import type { NodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { installCaptureTriggers, uncapturedWrites } from './sync/capture-harness';
import { outboxOps, shareBookForTest } from './sync/sync-helpers';

/*
 * Writing a shared event (shared events §5, §6, §7). A week by the coast in lira, on the phone of `me`. Rina and Andi
 * have the app; Budi and Dewi do not. Every write is captured whole (§6.4) and posts this phone's own share at once.
 * Invented rates: 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

let executor: NodeExecutor | undefined;
afterEach(() => {
  executor?.close();
  executor = undefined;
});

async function coastWeek(me = 'p-rina', claimed: Record<string, string | null> = { 'p-rina': 'p-rina', 'p-andi': 'p-andi', 'p-budi': null, 'p-dewi': null }) {
  const t = await setupDb();
  executor = t.executor;
  const ws = ownerScope(t.ws);
  for (const [from, rate] of [['EUR', 17_000], ['TRY', 560]] as const) {
    await upsertRate(t.database, { fromCurrency: from, toCurrency: 'IDR', onDate: '2026-10-01', rate, source: 'manual', sourceDate: '2026-10-01' });
  }
  const wallet = await createAccount(t.database, ws, { name: 'Euro wallet', kind: 'asset', subtype: 'cash', currency: 'EUR' });
  const lira = await createAccount(t.database, ws, { name: 'Lira cash', kind: 'asset', subtype: 'cash', currency: 'TRY' });
  const eventId = await saveEvent(t.database, ws, { name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12' });
  await shareBookForTest(t.database, 'ev-book', me);
  const names: Record<string, string> = { 'p-rina': 'Rina', 'p-andi': 'Andi', 'p-budi': 'Budi', 'p-dewi': 'Dewi' };
  await t.database.execScript(`
    INSERT INTO shared_events (book_id, name, starts_on, ends_on, currency, finished_at) VALUES ('ev-book', 'Coast week', '2026-10-05', '2026-10-12', 'TRY', NULL);
    INSERT INTO event_categories (book_id, id, name, icon, sort_order, archived_at) VALUES ('ev-book', 'cat-dinners', 'Dinners', NULL, 0, NULL);
    ${Object.entries(claimed).map(([id, member]) => `INSERT INTO event_people (book_id, id, name, member_id, removed_at) VALUES ('ev-book', '${id}', '${names[id]}', ${member ? `'${member}'` : 'NULL'}, NULL);`).join('\n')}
  `);
  const trip = await t.database.transaction((tx) => openEventBookTx(tx, ws, { bookId: 'ev-book', eventId, name: 'Coast week', currency: 'TRY' }));
  await installCaptureTriggers(t.database, 'ev-book');
  const dinner = (over: Partial<SharedExpenseInput> = {}): SharedExpenseInput => ({
    occurredOn: '2026-10-06',
    amountMinor: 9_000,
    currency: 'EUR',
    rateToEvent: '31.5',
    payerPersonId: me,
    paidFrom: { accountId: wallet.id, chargedMinor: null },
    split: { mode: 'equal', people: ['p-rina', 'p-andi', 'p-budi'] },
    categoryId: 'cat-dinners',
    note: 'Fish dinner',
    ...over,
  });
  const balanceOf = async (id: string) => (await nativeBalances(t.database, ws))[id] ?? 0;
  return { ...t, ws, wallet, lira, eventId, trip, dinner, balanceOf };
}

describe('recordSharedExpense', () => {
  it('writes both records and this phone’s share in one go; the account, card and channel never travel', async () => {
    const t = await coastWeek();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ channel: 'offline', mcc: '5812' }));
    const ops = await outboxOps(t.database);
    expect(ops.map((op) => [op.entity, op.id])).toEqual([['event_expense', id], ['event_expense_detail', id]]);
    const fields = ops.flatMap((op) => (op.op === 'upsert' ? Object.keys(op.fields) : []));
    for (const local of ['accountId', 'account', 'cardId', 'mcc', 'channel', 'photoIds', 'chargedMinor']) expect(fields).not.toContain(local);
    expect(ops[0]!.op === 'upsert' && ops[0]!.fields.payerMemberId).toBe('p-rina');
    expect(await t.balanceOf(t.wallet.id)).toBe(-9_000);
    expect(await t.balanceOf(t.trip)).toBe(189_000);
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
  });

  it('takes a payment by a person without the app, anyone’s to change after (D3)', async () => {
    const t = await coastWeek();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-budi', paidFrom: null }));
    expect(await t.database.db.values(sql`SELECT payer_member_id FROM event_expenses WHERE id = ${id}`)).toEqual([[null]]);
    expect(await t.balanceOf(t.trip)).toBe(-94_500);
  });

  it('refuses a payment by a person with the app (R13), and a split that does not add up', async () => {
    const t = await coastWeek();
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-andi', paidFrom: null }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(
      recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ split: { mode: 'amounts', shares: [{ personId: 'p-rina', minor: 1 }] } })),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('asks what a card in another currency was charged', async () => {
    const t = await coastWeek();
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ paidFrom: { accountId: t.lira.id, chargedMinor: null } }))).rejects.toThrow(/charged/);
  });
});

describe('editSharedExpense and voidSharedExpense (D8)', () => {
  it('lets anyone change a payment made outside the app, and only the payer change their own money', async () => {
    const t = await coastWeek();
    const budis = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-budi', paidFrom: null }));
    await editSharedExpense(t.database, t.ws, t.eventId, budis, { amountMinor: 6_000 });
    expect(await t.balanceOf(t.trip)).toBe(-63_000);
    await t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at) VALUES ('ev-book', 'exp-andi', '2026-10-07', 30000, 'TRY', '1', 'p-andi', 'p-andi', NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by) VALUES ('ev-book', 'exp-andi', 'Boat', NULL, 'equal', '["p-rina","p-andi"]', 'p-andi', NULL);
    `);
    await expect(editSharedExpense(t.database, t.ws, t.eventId, 'exp-andi', { amountMinor: 1_000 })).rejects.toMatchObject({ code: 'PAYER_ONLY', message: expect.stringContaining('Andi') });
    await expect(voidSharedExpense(t.database, t.ws, t.eventId, 'exp-andi')).rejects.toMatchObject({ code: 'PAYER_ONLY' });
    await editSharedExpense(t.database, t.ws, t.eventId, 'exp-andi', { split: { mode: 'equal', people: ['p-andi'] }, note: 'Boat, Andi alone' });
    expect(await t.database.db.values(sql`SELECT split_json, updated_by FROM event_expense_details WHERE id = 'exp-andi'`)).toEqual([['["p-andi"]', 'p-rina']]);
  });

  it('voids Rina’s own expense: its transaction goes void and the wallet comes back', async () => {
    const t = await coastWeek();
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
    await voidSharedExpense(t.database, t.ws, t.eventId, id);
    expect(await t.balanceOf(t.wallet.id)).toBe(0);
    expect(await t.balanceOf(t.trip)).toBe(0);
  });
});

describe('recordSettlement', () => {
  it('records Budi paying Rina 945 lira into her lira cash; refuses Rina writing what passed between Andi and Budi', async () => {
    const t = await coastWeek();
    await recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-budi', toPersonId: 'p-rina', amountMinor: 94_500, account: { accountId: t.lira.id, amountMinor: null } });
    expect(await t.balanceOf(t.lira.id)).toBe(94_500);
    expect(await t.balanceOf(t.trip)).toBe(-94_500);
    await expect(
      recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-andi', toPersonId: 'p-budi', amountMinor: 1_000, account: null }),
    ).rejects.toMatchObject({ code: 'INVALID' });
  });
});

describe('takeOverRecords (R6)', () => {
  it('Budi, who has just claimed his name, takes over the dinner Andi recorded as paid by him', async () => {
    const t = await coastWeek('p-budi', { 'p-rina': 'p-rina', 'p-andi': 'p-andi', 'p-budi': 'p-budi', 'p-dewi': null });
    await t.database.execScript(`
      INSERT INTO event_expenses (book_id, id, occurred_on, amount_minor, currency, rate_to_event, payer_person_id, payer_member_id, voided_at) VALUES ('ev-book', 'exp-b', '2026-10-06', 9000, 'EUR', '31.5', 'p-budi', NULL, NULL);
      INSERT INTO event_expense_details (book_id, id, note, category_id, split_mode, split_json, recorded_by, updated_by) VALUES ('ev-book', 'exp-b', 'Market', NULL, 'equal', '["p-rina","p-andi","p-budi"]', 'p-andi', NULL);
    `);
    await takeOverRecords(t.database, t.ws, t.eventId, { accountId: t.wallet.id, recordIds: ['exp-b'] });
    expect(await t.database.db.values(sql`SELECT payer_member_id FROM event_expenses WHERE id = 'exp-b'`)).toEqual([['p-budi']]);
    expect(await t.balanceOf(t.wallet.id)).toBe(-9_000);
    const ops = await outboxOps(t.database);
    expect(ops).toContainEqual(expect.objectContaining({ entity: 'event_expense', id: 'exp-b', fields: expect.objectContaining({ payerMemberId: 'p-budi' }) }));
  });
});

describe('people, currency and Done (D9, R9)', () => {
  it('removes a name at zero balance and in no record; refuses one who owes, one in a record and one with the app', async () => {
    const t = await coastWeek();
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
    // Dewi's own ticket, paid by Dewi for Dewi alone: a zero balance, but a record that names her.
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ payerPersonId: 'p-dewi', paidFrom: null, split: { mode: 'equal', people: ['p-dewi'] }, note: 'Ticket' }));
    const eko = await addEventPerson(t.database, t.ws, t.eventId, 'Eko');
    await expect(addEventPerson(t.database, t.ws, t.eventId, ' eko ')).rejects.toMatchObject({ code: 'INVALID' });
    await removeEventPerson(t.database, t.ws, t.eventId, eko);
    expect(await t.database.db.values(sql`SELECT removed_at IS NOT NULL FROM event_people WHERE id = ${eko}`)).toEqual([[1]]);
    await expect(removeEventPerson(t.database, t.ws, t.eventId, 'p-budi')).rejects.toMatchObject({ code: 'NOT_SETTLED', message: expect.stringContaining('Budi') });
    await expect(removeEventPerson(t.database, t.ws, t.eventId, 'p-dewi')).rejects.toMatchObject({ code: 'IN_USE' });
    await expect(removeEventPerson(t.database, t.ws, t.eventId, 'p-andi')).rejects.toMatchObject({ code: 'HAS_APP' });
  });

  it('changes the currency until the first expense, the trip balance with it, and not after', async () => {
    const t = await coastWeek();
    await setSharedEventCurrency(t.database, t.ws, t.eventId, 'EUR');
    expect(await t.database.db.values(sql`SELECT currency FROM accounts WHERE id = ${t.trip}`)).toEqual([['EUR']]);
    await setSharedEventCurrency(t.database, t.ws, t.eventId, 'TRY');
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
    await expect(setSharedEventCurrency(t.database, t.ws, t.eventId, 'EUR')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('keeps a Done event read-only until it is reopened', async () => {
    const t = await coastWeek();
    await finishSharedEvent(t.database, t.ws, t.eventId, true);
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner())).rejects.toMatchObject({ code: 'FINISHED', message: expect.stringContaining('Coast week') });
    await finishSharedEvent(t.database, t.ws, t.eventId, false);
    await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner());
  });
});

describe('the rest of the writes', () => {
  it('voids Budi paying Rina: the lira cash and the trip balance come back; a settle-up between others is not Rina’s to void', async () => {
    const t = await coastWeek();
    const id = await recordSettlement(t.database, t.ws, t.eventId, { occurredOn: '2026-10-12', fromPersonId: 'p-budi', toPersonId: 'p-rina', amountMinor: 94_500, account: { accountId: t.lira.id, amountMinor: null } });
    await voidSettlement(t.database, t.ws, t.eventId, id);
    expect(await t.balanceOf(t.lira.id)).toBe(0);
    expect(await t.balanceOf(t.trip)).toBe(0);
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
    await t.database.execScript(`
      INSERT INTO event_settlements (book_id, id, occurred_on, from_person_id, to_person_id, from_member_id, to_member_id, amount_minor, voided_at) VALUES ('ev-book', 'set-ab', '2026-10-12', 'p-andi', 'p-budi', 'p-andi', NULL, 1000, NULL);
    `);
    await expect(voidSettlement(t.database, t.ws, t.eventId, 'set-ab')).rejects.toMatchObject({ code: 'PAYER_ONLY', message: expect.stringContaining('Andi') });
  });

  it('saves, renames and archives a category; an expense keeps its archived category through a note edit', async () => {
    const t = await coastWeek();
    const boats = await saveEventCategory(t.database, t.ws, t.eventId, { name: ' Boats ' });
    await saveEventCategory(t.database, t.ws, t.eventId, { id: boats, name: 'Boat trips', icon: 'ferry' });
    expect(await t.database.db.values(sql`SELECT name, icon, sort_order FROM event_categories WHERE id = ${boats}`)).toEqual([['Boat trips', 'ferry', 1]]);
    const id = await recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ categoryId: boats }));
    await archiveEventCategory(t.database, t.ws, t.eventId, boats);
    await editSharedExpense(t.database, t.ws, t.eventId, id, { note: 'Ferry to the island' });
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ categoryId: boats }))).rejects.toMatchObject({ code: 'INVALID' });
    expect(await uncapturedWrites(t.database, 'ev-book')).toEqual([]);
  });

  it('renames a person unless the name is taken; never pays from the trip balance; knows a shared event from one that is not', async () => {
    const t = await coastWeek();
    await renameEventPerson(t.database, t.ws, t.eventId, 'p-budi', 'Budi S.');
    await expect(renameEventPerson(t.database, t.ws, t.eventId, 'p-dewi', 'budi s.')).rejects.toMatchObject({ code: 'INVALID' });
    await expect(recordSharedExpense(t.database, t.ws, t.eventId, t.dinner({ paidFrom: { accountId: t.trip, chargedMinor: null } }))).rejects.toMatchObject({ code: 'INVALID' });
    expect((await sharedEventOf(t.database, t.ws, t.eventId))?.bookId).toBe('ev-book');
    const plain = await saveEvent(t.database, t.ws, { name: 'Weekend', startsOn: '2026-11-01', endsOn: '2026-11-02' });
    expect(await sharedEventOf(t.database, t.ws, plain)).toBeNull();
    await expect(addEventPerson(t.database, t.ws, plain, 'Eko')).rejects.toMatchObject({ code: 'NOT_SHARED' });
  });
});
