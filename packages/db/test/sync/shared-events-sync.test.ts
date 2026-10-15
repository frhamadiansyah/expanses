import { uuidv7 } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  addEventPerson,
  createAccount,
  editSharedExpense,
  nativeBalances,
  ownerScope,
  personRefusalTx,
  recordSettlement,
  recordSharedExpense,
  renameEventPerson,
  retryUnpostedEventRecords,
  setSharedEventCurrency,
  sharedEventView,
  takeOverRecords,
  voidSharedExpense,
  eventBookTx,
  type SharedEventView,
} from '../../src/index';
import { withCapture } from '../../src/sync/capture';
import { SyncEngine } from '../../src/sync/engine';
import { encodeHlc } from '../../src/sync/hlc';
import type { ChangeSet, Op } from '../../src/sync/types';
import type { Device } from './household';
import { Trip } from './trip';

/*
 * Three phones on one relay (shared events §3, §5, §7): Rina and Andi with the app, Budi as a name until he joins. Each
 * phone posts only its own share; every phone suggests the same payments; a friend's edit never moves the payer's
 * account; a void beats an edit; a record made offline goes when the phone is back. Invented rates on every phone:
 * 1 EUR = 17,000 IDR, 1 TRY = 560 IDR.
 */

interface Phone {
  device: Device;
  eventId: string;
  person: string;
  euro: string;
}

async function coastWeek() {
  const trip = new Trip();
  const rina = await trip.device('Rina');
  const andi = await trip.device('Andi');
  const budi = await trip.device('Budi');
  await trip.share(rina, ['Budi']);
  await trip.join(andi, rina);
  await trip.settle([rina, andi]);
  const phone = async (d: Device): Promise<Phone> => {
    const [person] = await d.database.db.values<[string]>(sql`SELECT member_id FROM shared_books WHERE book_id = ${trip.bookId}`);
    const euro = await createAccount(d.database, ownerScope(d.ws), { name: `${d.name} euros`, kind: 'asset', subtype: 'cash', currency: 'EUR' });
    return { device: d, eventId: trip.eventOf(d), person: person![0], euro: euro.id };
  };
  const view = async (p: Phone): Promise<SharedEventView> => (await sharedEventView(p.device.database, ownerScope(p.device.ws), p.eventId))!;
  const personNamed = async (p: Phone, name: string) => (await view(p)).people.find((x) => x.name === name)!.personId;
  const tripBalance = async (p: Phone) => {
    const [row] = await p.device.database.db.values<[string]>(sql`SELECT balance_account_id FROM event_books WHERE book_id = ${trip.bookId}`);
    return (await nativeBalances(p.device.database, ownerScope(p.device.ws)))[row![0]] ?? 0;
  };
  return { trip, rina: await phone(rina), andi: await phone(andi), budiDevice: budi, phone, view, personNamed, tripBalance };
}

type Setup = Awaited<ReturnType<typeof coastWeek>>;

async function dinner(s: Setup) {
  const budi = await s.personNamed(s.rina, 'Budi');
  return recordSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, {
    occurredOn: '2026-10-06', amountMinor: 9_000, currency: 'EUR', rateToEvent: '31.5', payerPersonId: s.rina.person,
    paidFrom: { accountId: s.rina.euro, chargedMinor: null }, split: { mode: 'equal', people: [s.rina.person, s.andi.person, budi] }, categoryId: null, note: 'Fish dinner',
  });
}

async function boat(s: Setup) {
  return recordSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, {
    occurredOn: '2026-10-08', amountMinor: 60_000, currency: 'TRY', rateToEvent: '1', payerPersonId: s.andi.person,
    paidFrom: { accountId: s.andi.device.bank, chargedMinor: 336_000 }, split: { mode: 'equal', people: [s.rina.person, s.andi.person] }, categoryId: null, note: 'Boat',
  });
}

/** One change-set of these ops, signed by `from`'s real key, straight onto the event's relay book. */
async function forge(s: Setup, from: Device, member: string, ...ops: Op[]): Promise<void> {
  const [row] = await from.database.db.values<[string, number]>(sql`SELECT relay_book_id, epoch FROM shared_books WHERE book_id = ${s.trip.bookId}`);
  const cs: ChangeSet = { v: 1, hlc: encodeHlc(Date.now() + 1_000, 0, from.deviceId), member, ops };
  await from.transport.append(row![0], await from.engine.sealer.seal(s.trip.bookId, Number(row![1]), cs));
}

/** A whole expense as a peer's op pair, paid outside the app (anyone's): what a modified client could put on the relay. */
function forgedExpense(s: Setup, id: string, fields: { occurredOn: string; rateToEvent: string; currency: string; payer: string; people: string[] }): Op[] {
  return [
    {
      entity: 'event_expense', id, op: 'upsert',
      fields: { occurredOn: fields.occurredOn, amountMinor: 30_000, currency: fields.currency, rateToEvent: fields.rateToEvent, payerPersonId: fields.payer, payerMemberId: null, voidedAt: null },
    },
    {
      entity: 'event_expense_detail', id, op: 'upsert',
      fields: { note: 'Forged', categoryId: null, splitMode: 'equal', splitJson: JSON.stringify(fields.people), recordedBy: s.andi.person, updatedBy: null },
    },
  ];
}

/** A currency change written as the screen would, but past its refusal: a stale view, or an older build. */
async function currencyPastTheScreen(d: Device, currency: string): Promise<void> {
  const [book] = await d.database.db.values<[string]>(sql`SELECT book_id FROM event_books`);
  await d.database.transaction((tx) =>
    withCapture(tx, { entity: 'shared_event', id: book![0], bookId: book![0] }, () => tx.run(sql`UPDATE shared_events SET currency = ${currency} WHERE book_id = ${book![0]}`)),
  );
}

const posting = async (p: Phone, bookId: string, recordId: string) =>
  (await p.device.database.db.values<[string | null, string | null]>(sql`SELECT transaction_id, unposted FROM event_postings WHERE book_id = ${bookId} AND record_id = ${recordId}`))[0];

describe('three phones, one event', () => {
  it('each phone posts its own share, and its trip balance is its Balances line (Review Focus 2)', async () => {
    const s = await coastWeek();
    await dinner(s);
    await boat(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    for (const p of [s.rina, s.andi]) {
      const me = (await s.view(p)).people.find((x) => x.isMe)!;
      expect(await s.tripBalance(p)).toBe(me.balanceMinor);
    }
    expect(await s.tripBalance(s.rina)).toBe(189_000 - 30_000);
    expect(await s.tripBalance(s.andi)).toBe(30_000 - 94_500);
    // Andi's bank paid the boat on Andi's phone only; nothing of it on Rina's.
    expect((await nativeBalances(s.andi.device.database, ownerScope(s.andi.device.ws)))[s.andi.device.bank]).toBe(-336_000);
    expect((await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws)))[s.rina.device.bank] ?? 0).toBe(0);
  });

  it('every phone suggests the same payments (Review Focus 4)', async () => {
    const s = await coastWeek();
    await dinner(s);
    await boat(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.andi)).payments).toEqual((await s.view(s.rina)).payments);
    expect((await s.view(s.rina)).payments.length).toBeGreaterThan(0);
  });

  it('a friend’s split edit replaces the payer’s posting and says who, without moving the payer’s wallet (Review Focus 5)', async () => {
    const s = await coastWeek();
    const id = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    await editSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, id, { split: { mode: 'equal', people: [s.rina.person, s.andi.person] } });
    await s.trip.settle([s.rina.device, s.andi.device]);
    const rinaBooks = await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws));
    expect(rinaBooks[s.rina.euro]).toBe(-9_000);
    expect(await s.tripBalance(s.rina)).toBe(141_750);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)!.posting!.changedByName).toBe('Andi');
    // Andi cannot touch the money of what Rina paid — not through the screen, not through a forged op.
    await expect(editSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, id, { amountMinor: 1 })).rejects.toMatchObject({ code: 'PAYER_ONLY' });
    await forge(s, s.andi.device, s.andi.person, { entity: 'event_expense', id, op: 'upsert', fields: { amountMinor: 1 } });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws)))[s.rina.euro]).toBe(-9_000);
    const skipped = await s.rina.device.database.db.values<[string, string]>(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${s.trip.bookId}`);
    expect(skipped).toEqual([['event_expense', expect.stringMatching(/^AUTHORITY: only the person whose money it is/)]]);
  });

  it('a void beats an edit made at the same time', async () => {
    const s = await coastWeek();
    const id = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    await voidSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, id);
    await editSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, id, { note: 'Fish dinner, two tables' });
    await s.trip.settle([s.rina.device, s.andi.device]);
    for (const p of [s.rina, s.andi]) {
      expect((await s.view(p)).expenses.find((e) => e.expenseId === id)!.voided).toBe(true);
      expect(await s.tripBalance(p)).toBe(0);
    }
  });

  it('Budi claims his name, takes over what was recorded as paid by him, and the books agree', async () => {
    const s = await coastWeek();
    const budiPerson = await s.personNamed(s.rina, 'Budi');
    const market = await recordSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, {
      occurredOn: '2026-10-07', amountMinor: 180_000, currency: 'TRY', rateToEvent: '1', payerPersonId: budiPerson, paidFrom: null,
      split: { mode: 'equal', people: [s.rina.person, budiPerson] }, categoryId: null, note: 'Market',
    });
    await s.trip.settle([s.rina.device, s.andi.device]);
    await s.trip.join(s.budiDevice, s.rina.device, 'Budi');
    await s.trip.settle([s.rina.device, s.andi.device, s.budiDevice]);
    const budi = await s.phone(s.budiDevice);
    expect((await s.view(budi)).waiting).toEqual([{ recordId: market, kind: 'expense', reason: 'choose-account' }]);
    await takeOverRecords(budi.device.database, ownerScope(budi.device.ws), budi.eventId, { accountId: budi.device.cash, recordIds: [market] });
    await s.trip.settle([s.rina.device, s.andi.device, s.budiDevice]);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === market)!.payerHasAccount).toBe(true);
    expect((await s.view(budi)).waiting).toEqual([]);
    expect(await s.tripBalance(budi)).toBe((await s.view(budi)).people.find((x) => x.isMe)!.balanceMinor);
  });

  it('Andi settles up in rupiah; Rina says where it arrived; both balances are zero for Andi', async () => {
    const s = await coastWeek();
    await boat(s);
    const dinnerId = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    const owed = (await s.view(s.andi)).payments.find((p) => p.fromPersonId === s.andi.person && p.toPersonId === s.rina.person)!;
    const settlement = await recordSettlement(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, {
      occurredOn: '2026-10-12', fromPersonId: s.andi.person, toPersonId: s.rina.person, amountMinor: owed.amountMinor, account: { accountId: s.andi.device.bank, amountMinor: 361_200 },
    });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.rina)).waiting).toEqual([{ recordId: settlement, kind: 'settlement', reason: 'choose-account' }]);
    await takeOverRecords(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, { accountId: s.rina.device.bank, recordIds: [settlement] });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.rina)).people.find((x) => x.personId === s.andi.person)!.balanceMinor).toBe(0);
    expect(await s.tripBalance(s.andi)).toBe(0);
    expect(dinnerId).toBeTruthy();
  });

  it('a record made while the phone is offline waits as "Not sent yet", then reaches the others', async () => {
    const s = await coastWeek();
    const id = await boat(s); // not synced
    expect((await s.view(s.andi)).expenses.find((e) => e.expenseId === id)!.unsent).toBe(true);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)).toBeUndefined();
    await s.trip.settle([s.andi.device, s.rina.device]);
    expect((await s.view(s.andi)).expenses.find((e) => e.expenseId === id)!.unsent).toBe(false);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)).toBeDefined();
  });

  it('a currency changed on a phone that had not heard of the first expense goes back to the log’s on every phone (R8)', async () => {
    const s = await coastWeek();
    await dinner(s);
    await s.rina.device.engine.syncOnce(s.trip.bookId);
    // The screen refuses it now that Rina's phone is in (I1); a stale or older build writes it past the screen.
    await expect(setSharedEventCurrency(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, 'EUR')).rejects.toThrow('fixed once someone else has joined');
    await currencyPastTheScreen(s.andi.device, 'EUR');
    await s.trip.settle([s.andi.device, s.rina.device]);
    for (const p of [s.rina, s.andi]) {
      expect(await p.device.database.db.values(sql`SELECT currency FROM shared_events WHERE book_id = ${s.trip.bookId}`)).toEqual([['TRY']]);
      expect(await p.device.database.db.values(sql`SELECT a.currency FROM event_books b JOIN accounts a ON a.id = b.balance_account_id WHERE b.book_id = ${s.trip.bookId}`)).toEqual([['TRY']]);
    }
    expect(await s.tripBalance(s.andi)).toBe(-94_500);
  });
});

describe('what apply does with records it cannot post, and the edges between phones', () => {
  it('a derivation the ledger refuses, or a rate that cannot be read, leaves the record in and waiting, and the rest of the pull goes on', async () => {
    const s = await coastWeek();
    const budi = await s.personNamed(s.rina, 'Budi');
    const badDate = uuidv7();
    const badRate = uuidv7();
    // Both name Rina in the split, so her phone has a share to post; the ledger refuses the first's date and core the second's rate.
    await forge(
      s, s.andi.device, s.andi.person,
      ...forgedExpense(s, badDate, { occurredOn: 'soon', rateToEvent: '1', currency: 'TRY', payer: budi, people: [s.rina.person, budi] }),
      ...forgedExpense(s, badRate, { occurredOn: '2026-10-09', rateToEvent: 'many', currency: 'EUR', payer: budi, people: [s.rina.person, budi] }),
    );
    const boatId = await boat(s);
    await s.trip.settle([s.andi.device, s.rina.device]);
    // The records stayed in, every op applied: nothing skipped, the cursor past them.
    expect(await s.rina.device.database.db.values(sql`SELECT id FROM event_expenses WHERE book_id = ${s.trip.bookId} AND id IN (${badDate}, ${badRate}) ORDER BY id`)).toEqual([[badDate], [badRate]].sort());
    expect(await s.rina.device.database.db.values(sql`SELECT entity, error FROM sync_skipped WHERE book_id = ${s.trip.bookId}`)).toEqual([]);
    expect(await posting(s.rina, s.trip.bookId, badDate)).toEqual([null, 'malformed']);
    expect(await posting(s.rina, s.trip.bookId, badRate)).toEqual([null, 'malformed']);
    // Tried again after every sync, they stay waiting without stopping the retry of anything else.
    expect(await retryUnpostedEventRecords(s.rina.device.database, s.trip.bookId)).toBe(0);
    // The boat, behind them in the log, posted: Rina owes her half of it on the trip balance.
    const [boatPosting] = await s.rina.device.database.db.values<[string | null, string | null]>(sql`SELECT transaction_id, unposted FROM event_postings WHERE book_id = ${s.trip.bookId} AND record_id = ${boatId}`);
    expect(boatPosting![1]).toBeNull();
    expect(await s.tripBalance(s.rina)).toBe(-30_000);
  });

  it('once a second phone is in, a currency change is stripped in log order on every phone, expense or none (I1)', async () => {
    const s = await coastWeek();
    // Rina switches to euros on a phone that has not heard Andi joined; Andi, on lira, records a taxi in rupiah at a
    // rate to lira. Before the fix the log took Rina's change and read Andi's lira rate as euros (about 35 times over).
    await currencyPastTheScreen(s.rina.device, 'EUR');
    const taxi = await recordSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, {
      occurredOn: '2026-10-08', amountMinor: 280_000, currency: 'IDR', rateToEvent: '0.0018', payerPersonId: s.andi.person,
      paidFrom: { accountId: s.andi.device.bank, chargedMinor: null }, split: { mode: 'equal', people: [s.rina.person, s.andi.person] }, categoryId: null, note: 'Taxi',
    });
    await s.rina.device.engine.syncOnce(s.trip.bookId);
    await s.trip.settle([s.rina.device, s.andi.device]);
    for (const p of [s.rina, s.andi]) {
      expect(await p.device.database.db.values(sql`SELECT currency FROM shared_events WHERE book_id = ${s.trip.bookId}`)).toEqual([['TRY']]);
      expect(await p.device.database.db.values(sql`SELECT a.currency FROM event_books b JOIN accounts a ON a.id = b.balance_account_id WHERE b.book_id = ${s.trip.bookId}`)).toEqual([['TRY']]);
      expect((await s.view(p)).expenses.find((e) => e.expenseId === taxi)!.eventAmountMinor).toBe(50_400);
    }
    expect(await s.tripBalance(s.rina)).toBe(-25_200);
    expect(await s.tripBalance(s.andi)).toBe(25_200);
  });

  it('a person renamed on another phone renames the settle-ups that name them, on every phone', async () => {
    const s = await coastWeek();
    await boat(s);
    await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    const owed = (await s.view(s.andi)).payments.find((p) => p.fromPersonId === s.andi.person && p.toPersonId === s.rina.person)!;
    const settlement = await recordSettlement(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, {
      occurredOn: '2026-10-12', fromPersonId: s.andi.person, toPersonId: s.rina.person, amountMinor: owed.amountMinor, account: { accountId: s.andi.device.bank, amountMinor: 361_200 },
    });
    await s.trip.settle([s.rina.device, s.andi.device]);
    await takeOverRecords(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, { accountId: s.rina.device.bank, recordIds: [settlement] });
    await s.trip.settle([s.rina.device, s.andi.device]);
    const description = async (p: Phone) =>
      (await p.device.database.db.values<[string]>(sql`SELECT t.description FROM event_postings e JOIN transactions t ON t.id = e.transaction_id WHERE e.book_id = ${s.trip.bookId} AND e.record_id = ${settlement}`))[0]![0];
    expect(await description(s.rina)).toBe('Andi paid Rina');
    expect(await description(s.andi)).toBe('Andi paid Rina');
    const rinaBank = (await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws)))[s.rina.device.bank];
    await renameEventPerson(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, s.andi.person, 'Andika');
    expect(await description(s.andi)).toBe('Andika paid Rina');
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect(await description(s.rina)).toBe('Andika paid Rina');
    // The money stayed where it was.
    expect((await nativeBalances(s.rina.device.database, ownerScope(s.rina.device.ws)))[s.rina.device.bank]).toBe(rinaBank);
    expect(rinaBank).toBeGreaterThan(0);
  });

  it('capture judges only the rows a write changed: a friend’s detail edit under a capture of both halves goes, an amount does not', async () => {
    const s = await coastWeek();
    const id = await dinner(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    const both = [
      { entity: 'event_expense', id, bookId: s.trip.bookId },
      { entity: 'event_expense_detail', id, bookId: s.trip.bookId },
    ];
    const db = s.andi.device.database;
    await db.transaction((tx) =>
      withCapture(tx, both, () => tx.run(sql`UPDATE event_expense_details SET note = 'Fish dinner by the harbour' WHERE book_id = ${s.trip.bookId} AND id = ${id}`)),
    );
    await expect(
      db.transaction((tx) => withCapture(tx, both, () => tx.run(sql`UPDATE event_expenses SET amount_minor = 1 WHERE book_id = ${s.trip.bookId} AND id = ${id}`))),
    ).rejects.toThrow(/AUTHORITY: only the person whose money it is/);
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)!.note).toBe('Fish dinner by the harbour');
    expect((await s.view(s.rina)).expenses.find((e) => e.expenseId === id)!.amountMinor).toBe(9_000);
  });

  it('a restored phone that joins again re-matches the postings it kept: no second transaction, none of the good ones voided', async () => {
    const s = await coastWeek();
    const dinnerId = await dinner(s);
    const boatId = await boat(s);
    await s.trip.settle([s.rina.device, s.andi.device]);
    // History the pull from the first entry has to walk past: a split edited after it was recorded.
    await editSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, dinnerId, { split: { mode: 'equal', people: [s.rina.person, s.andi.person] } });
    await s.trip.settle([s.rina.device, s.andi.device]);
    const kept = async (d: Device) =>
      d.database.db.values<[string, string, string]>(sql`
        SELECT e.record_id, e.transaction_id, t.status FROM event_postings e JOIN transactions t ON t.id = e.transaction_id WHERE e.book_id = ${s.trip.bookId} ORDER BY e.record_id`);
    const before = await kept(s.andi.device);
    expect(before.map(([, , status]) => status)).toEqual(['posted', 'posted']);
    const backup = await s.andi.device.database.exportBytes();
    // While the phone is away: a taxi Rina paid for both.
    const taxi = await recordSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, {
      occurredOn: '2026-10-10', amountMinor: 8_000, currency: 'TRY', rateToEvent: '1', payerPersonId: s.rina.person,
      paidFrom: { accountId: s.rina.device.cash, chargedMinor: 44_800 }, split: { mode: 'equal', people: [s.rina.person, s.andi.person] }, categoryId: null, note: 'Taxi',
    });
    await s.rina.device.engine.syncOnce(s.trip.bookId);

    const restored = await s.trip.home.restore(s.andi.device, backup);
    restored.engine = new SyncEngine(restored.database, restored.transport, restored.keys, undefined, { appVersion: '0.4.0' });
    expect(await restored.engine.checkRestore()).toContain(s.trip.bookId);
    const transactionsBefore = await restored.database.db.values<[number]>(sql`SELECT count(*) FROM transactions`);
    // The lost phone is removed first (C2): only then does an invite made by someone else link a phone as Andi.
    await s.rina.device.engine.removeDevice(s.trip.bookId, s.andi.device.deviceId);
    await s.rina.device.engine.syncOnce(s.trip.bookId);
    const { code } = await s.rina.device.engine.createEventInvite(s.trip.bookId, { inviterName: 'Rina', forPersonId: s.andi.person });
    await restored.engine.joinEvent(code, { ws: restored.ws, personId: null, name: 'Andi', deviceName: 'Andi’s restored phone' });
    await s.trip.settle([s.rina.device, restored]);

    const after = await kept(restored);
    expect(after.filter(([id]) => id !== taxi)).toEqual(before);
    expect(after.find(([id]) => id === taxi)?.[2]).toBe('posted');
    // One new transaction (the taxi) and nothing else: no replay of the history, no void.
    expect(await restored.database.db.values(sql`SELECT count(*) FROM transactions`)).toEqual([[Number(transactionsBefore[0]![0]) + 1]]);
    expect(await restored.database.db.values(sql`SELECT count(*) FROM transactions WHERE status <> 'posted'`)).toEqual(
      await s.andi.device.database.db.values(sql`SELECT count(*) FROM transactions WHERE status <> 'posted'`),
    );
    const phone: Phone = { ...s.andi, device: restored };
    expect(await s.tripBalance(phone)).toBe((await s.view(phone)).people.find((x) => x.isMe)!.balanceMinor);
    expect((await nativeBalances(restored.database, ownerScope(restored.ws)))[restored.bank]).toBe(-336_000);
    expect(await s.tripBalance(phone)).toBe(30_000 - 141_750 - 4_000);
    expect(boatId).toBeTruthy();
  });

  it('Budi takes over what Rina paid for him a moment before Andi, offline, deletes it: Andi’s own phone puts it back, as every phone has it (I3)', async () => {
    const s = await coastWeek();
    const budiPerson = await s.personNamed(s.rina, 'Budi');
    // Rina records the boat Budi paid (Budi has no app yet): anyone's to change.
    const boatId = await recordSharedExpense(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, {
      occurredOn: '2026-10-08', amountMinor: 30_000, currency: 'TRY', rateToEvent: '1', payerPersonId: budiPerson,
      paidFrom: null, split: { mode: 'equal', people: [s.rina.person, s.andi.person, budiPerson] }, categoryId: null, note: 'Boat',
    });
    await s.trip.settle([s.rina.device, s.andi.device]);
    await s.trip.join(s.budiDevice, s.rina.device, 'Budi');
    const budi = await s.phone(s.budiDevice);
    await s.trip.settle([s.rina.device, budi.device]);
    // Budi takes it over into his own bank; that reaches the log first.
    await takeOverRecords(budi.device.database, ownerScope(budi.device.ws), budi.eventId, { accountId: budi.device.bank, recordIds: [boatId] });
    await budi.device.engine.syncOnce(s.trip.bookId);
    // Andi, who has not heard of it, deletes the boat: allowed on his phone, refused by the log (only Budi now).
    await voidSharedExpense(s.andi.device.database, ownerScope(s.andi.device.ws), s.andi.eventId, boatId);
    await s.trip.settle([s.andi.device, s.rina.device, budi.device]);
    for (const p of [s.rina, s.andi, budi]) {
      const boat = (await s.view(p)).expenses.find((e) => e.expenseId === boatId)!;
      expect(boat.voided).toBe(false);
      expect(boat.payerHasAccount).toBe(true);
    }
    expect(await s.andi.device.database.db.values(sql`SELECT error FROM sync_skipped WHERE book_id = ${s.trip.bookId} AND entity = 'event_expense' AND id = ${boatId}`)).toEqual([
      ['AUTHORITY: only the person whose money it is changes it'],
    ]);
    // Andi's share is back in his books, and every phone reads the same balances and payments.
    expect(await s.tripBalance(s.andi)).toBe((await s.view(s.andi)).people.find((x) => x.isMe)!.balanceMinor);
    expect(await s.tripBalance(s.andi)).toBe(-10_000);
    expect((await s.view(s.andi)).people).toEqual((await s.view(s.rina)).people.map((x) => ({ ...x, isMe: x.personId === s.andi.person })));
    expect((await s.view(s.andi)).payments).toEqual((await s.view(budi)).payments);
  });

  it('a workspace row sent in the event’s log is refused on every phone, never written into a workspace (I4)', async () => {
    const s = await coastWeek();
    const before = await s.rina.device.database.db.values(sql`SELECT count(*) FROM accounts`);
    await forge(s, s.andi.device, s.andi.person, { entity: 'category', id: 'forged-category', op: 'upsert', fields: { name: 'Planted', kind: 'expense', parentId: null } });
    await s.trip.settle([s.rina.device, s.andi.device]);
    expect(await s.rina.device.database.db.values(sql`SELECT entity, id, error FROM sync_skipped WHERE book_id = ${s.trip.bookId}`)).toEqual([
      ['category', 'forged-category', "AUTHORITY: category inside a shared event's book"],
    ]);
    expect(await s.rina.device.database.db.values(sql`SELECT count(*) FROM accounts`)).toEqual(before);
  });

  it('a peer’s rate that cannot be read never crashes the leave and remove checks: that record is not counted, and its people stay', async () => {
    const s = await coastWeek();
    const citra = await addEventPerson(s.rina.device.database, ownerScope(s.rina.device.ws), s.rina.eventId, 'Citra');
    const budi = await s.personNamed(s.rina, 'Budi');
    await forge(s, s.rina.device, s.rina.person, ...forgedExpense(s, uuidv7(), { occurredOn: '2026-10-09', rateToEvent: 'many', currency: 'EUR', payer: budi, people: [s.andi.person, budi] }));
    await s.trip.settle([s.rina.device, s.andi.device]);
    const book = (await eventBookTx(s.andi.device.database.db, s.trip.bookId))!;
    // Andi is in it: his balance cannot be worked out, so he stays — said plainly, not thrown from core.
    const andiRefusal = await personRefusalTx(s.andi.device.database.db, book, s.andi.person);
    expect(andiRefusal).toMatchObject({ code: 'NOT_SETTLED', message: expect.stringContaining('Andi') });
    await expect(s.andi.device.engine.leaveEvent(s.trip.bookId)).rejects.toMatchObject({ code: 'NOT_SETTLED' });
    // Citra is in nothing: the unreadable record does not stand in her way.
    expect(await personRefusalTx(s.andi.device.database.db, book, citra)).toBeNull();
  });
});
