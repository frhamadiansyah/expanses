import { expenseLines, transferLines, transferWithFeeLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createBook,
  deleteEventCopy,
  finishSharedEvent,
  eventTransferOf,
  inBook,
  listSharedTransfers,
  listTransactions,
  moveIntoSharedEvent,
  nativeBalances,
  ownerScope,
  personalBook,
  postTransaction,
  removeTransferFromSharedEvent,
  replaceTransaction,
  runSharedBookRepairs,
  sharedEventView,
  voidTransaction,
} from '../../src/index';
import { SyncEngine } from '../../src/sync/engine';
import { categoryOf, projectBook, skipsOf, type Device } from './household';
import { Trip } from './trip';

/*
 * A Family transfer (an ATM withdrawal from the bank into the wallet) moved into the shared trip (trip withdrawal,
 * owner, 13 Nov 2026): it leaves Family's list on both phones, is listed on the trip, not counted, and Remove from event
 * puts it back. The ledger transaction never changes. Invented figures throughout; 1 TRY = 560 IDR (`Trip`).
 */

const BUILD = '0.5.2';

async function familyAndTrip(versions: { wife?: string; husband?: string } = {}) {
  const trip = new Trip();
  const wife = await trip.device('Wife', versions.wife ?? BUILD);
  const husband = await trip.device('Husband', versions.husband ?? BUILD);
  const home = trip.home;
  const family = await home.share(wife);
  await home.join(husband, wife);
  await home.settle();
  await trip.share(wife);
  await trip.join(husband, wife);
  await trip.settle([wife, husband]);
  const settle = async () => {
    await home.settle();
    await trip.settle([wife, husband]);
    await home.settle();
  };
  return { trip, home, wife, husband, family, settle };
}

type Setup = Awaited<ReturnType<typeof familyAndTrip>>;

/** The wife's ATM withdrawal in Family: Rp 2.240.000 out of her bank into her wallet. */
async function withdrawal(s: Setup, occurredOn = '2026-10-08', description = 'ATM withdrawal'): Promise<string> {
  return postTransaction(s.wife.database, inBook(s.wife.ws, s.family), {
    occurredOn,
    description,
    fileTransfer: true,
    lines: transferLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 2_240_000, currency: 'IDR' }),
  });
}


/** What Family's Cashflow lists on a phone for October: its own rows and the partner's transfers. */
async function familyRows(s: Setup, d: Device): Promise<string[]> {
  const own = (await listTransactions(d.database, inBook(d.ws, s.family), { from: '2026-10-01', to: '2026-10-31' })).map((t) => t.description);
  const partner = (await listSharedTransfers(d.database, s.family, { from: '2026-10-01', to: '2026-10-31' })).map((t) => `partner: ${t.description}`);
  return [...own, ...partner].sort();
}

async function tripOf(s: Setup, d: Device) {
  return (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
}

describe('a Family transfer moved into a shared trip', () => {
  it('leaves Family on both phones, is listed on the trip on both, not counted, and its accounts stay as they were', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    const before = await nativeBalances(s.wife.database, s.wife.ws);

    const result = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    expect(result).toEqual({ moved: [], kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    expect(await skipsOf(s.wife.database)).toEqual([]);

    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
    // The transaction is as it was: posted, in the bank's own history, balances unchanged.
    const [row] = await s.wife.database.db.values<[string, string | null]>(sql`SELECT status, event_id FROM transactions WHERE id = ${id}`);
    expect(row).toEqual(['posted', null]);
    expect((await listTransactions(s.wife.database, ownerScope(s.wife.ws), { accountId: s.wife.bank })).map((t) => t.id)).toContain(id);
    expect(await nativeBalances(s.wife.database, s.wife.ws)).toEqual(before);

    for (const d of [s.wife, s.husband]) {
      const view = await tripOf(s, d);
      expect(view.transfers.map((t) => [t.occurredOn, t.description, t.amountMinor, t.currency, t.recordedByName])).toEqual([['2026-10-08', 'ATM withdrawal', 2_240_000, 'IDR', 'Wife']]);
      // Not counted: no expense, no total, no balance, nothing to settle.
      expect(view.expenses).toEqual([]);
      expect(view.spentMinor).toBe(0);
      expect(view.myShareMinor).toBe(0);
      expect(view.people.every((p) => p.balanceMinor === 0)).toBe(true);
      expect(view.payments).toEqual([]);
    }
    // The recorder's phone opens its own transaction and names its own accounts; the partner's has neither.
    expect((await tripOf(s, s.wife)).transfers[0]).toMatchObject({ transactionId: id, fromName: 'Wife Bank', toName: 'Wife Wallet' });
    expect((await tripOf(s, s.husband)).transfers[0]).toMatchObject({ transactionId: null, fromName: null, toName: null });
    expect(await eventTransferOf(s.wife.database, id)).toEqual({ eventId: s.trip.eventOf(s.wife), eventName: 'Coast week' });
    // The two phones hold the same shared rows.
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('Remove from event puts it back in Family on both phones and takes it off the trip', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();

    await removeTransferFromSharedEvent(s.wife.database, s.wife.ws, id);
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    for (const d of [s.wife, s.husband]) expect((await tripOf(s, d)).transfers).toEqual([]);
    expect(await eventTransferOf(s.wife.database, id)).toBeNull();
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));

    // And in again: the same row, listed once more.
    const again = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    expect(again.listed).toEqual([{ transactionId: id }]);
    await s.settle();
    expect(await familyRows(s, s.husband)).toEqual([]);
    expect((await tripOf(s, s.husband)).transfers).toHaveLength(1);
  });

  it('an edit keeps it on the trip with the new figure; deleted, it is gone from the trip and from Family', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();

    const edited = await replaceTransaction(s.wife.database, inBook(s.wife.ws, s.family), id, {
      occurredOn: '2026-10-09',
      description: 'ATM withdrawal',
      lines: transferLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 2_800_000, currency: 'IDR' }),
    });
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
    for (const d of [s.wife, s.husband]) expect((await tripOf(s, d)).transfers.map((t) => [t.occurredOn, t.amountMinor])).toEqual([['2026-10-09', 2_800_000]]);
    expect((await tripOf(s, s.wife)).transfers[0]!.transactionId).toBe(edited);

    await voidTransaction(s.wife.database, inBook(s.wife.ws, s.family), edited);
    await s.settle();
    for (const d of [s.wife, s.husband]) expect((await tripOf(s, d)).transfers).toEqual([]);
    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('edited into a transfer with a fee (a purchase now), it leaves the trip and is Family spending on both phones, with no row left behind', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();
    const fees = await categoryOf(s.wife.database, s.family, 'Groceries');
    const edited = await replaceTransaction(s.wife.database, inBook(s.wife.ws, s.family), id, {
      occurredOn: '2026-10-08',
      description: 'ATM withdrawal',
      lines: transferWithFeeLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 2_240_000, feeMinor: 7_500, currency: 'IDR', feeCategoryId: fees }),
    });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    for (const d of [s.wife, s.husband]) expect((await tripOf(s, d)).transfers).toEqual([]);
    // No live redacted row is left pointing at the replaced transaction, on either phone.
    for (const d of [s.wife, s.husband]) expect(await d.database.db.values(sql`SELECT transfer_id FROM shared_transfers WHERE void = 0`)).toEqual([]);
    expect(await eventTransferOf(s.wife.database, edited)).toBeNull();
    expect((await listTransactions(s.wife.database, inBook(s.wife.ws, s.family), {})).map((t) => t.id)).toEqual([edited]);
    expect(await listSharedTransfers(s.husband.database, s.family)).toEqual([]);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('moved to another workspace it leaves the trip, and moved back it is in Family again, never on the trip', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();
    const business = await createBook(s.wife.database, s.wife.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const lines = transferLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 2_240_000, currency: 'IDR' });
    const out = await replaceTransaction(s.wife.database, s.wife.ws, id, { occurredOn: '2026-10-08', description: 'ATM withdrawal', lines, moveToBook: true, toBookId: business });
    await s.settle();
    for (const d of [s.wife, s.husband]) expect((await tripOf(s, d)).transfers).toEqual([]);
    await replaceTransaction(s.wife.database, s.wife.ws, out, { occurredOn: '2026-10-08', description: 'ATM withdrawal', lines, moveToBook: true, toBookId: s.family });
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    for (const d of [s.wife, s.husband]) expect((await tripOf(s, d)).transfers).toEqual([]);
  });

  it('stays in Family, with the reason, while a phone in Family runs a build that would keep listing it there', async () => {
    const s = await familyAndTrip({ husband: '0.5.1' });
    const id = await withdrawal(s);
    await s.settle();
    const result = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    expect(result.listed).toEqual([]);
    expect(result.kept).toEqual([{ transactionId: id, why: "Update cicis on Husband's phone first: until then it would stay in Personal there" }]);
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
  });

  it('a phone that joins Family after the move never lists it there (the seed carries the event)', async () => {
    const trip = new Trip();
    const wife = await trip.device('Wife', BUILD);
    const husband = await trip.device('Husband', BUILD);
    const family = await trip.home.share(wife);
    await trip.share(wife);
    await trip.join(husband, wife);
    await trip.settle([wife, husband]);
    const s = { trip, home: trip.home, wife, husband, family, settle: async () => undefined } as unknown as Setup;
    const id = await withdrawal(s);
    const { listed } = await moveIntoSharedEvent(wife.database, ownerScope(wife.ws), trip.eventOf(wife), [id]);
    expect(listed).toEqual([{ transactionId: id }]);
    await trip.home.join(husband, wife);
    await trip.home.settle();
    await trip.settle([wife, husband]);
    expect(await familyRows(s, husband)).toEqual([]);
    expect((await tripOf(s, husband)).transfers.map((t) => t.description)).toEqual(['ATM withdrawal']);
  });

  it('a phone on an older build that joins Family after the move gets the event again once it updates, and the phones agree', async () => {
    const trip = new Trip();
    const wife = await trip.device('Wife', BUILD);
    const husband = await trip.device('Husband', '0.5.1');
    const family = await trip.home.share(wife);
    await trip.share(wife);
    await trip.join(husband, wife);
    await trip.settle([wife, husband]);
    const s = { trip, home: trip.home, wife, husband, family, settle: async () => undefined } as unknown as Setup;
    const id = await withdrawal(s);
    expect((await moveIntoSharedEvent(wife.database, ownerScope(wife.ws), trip.eventOf(wife), [id])).listed).toHaveLength(1);
    expect((await runSharedBookRepairs(wife.database, family)).tripTransfers).toBe(1);
    await trip.home.join(husband, wife);
    await trip.home.settle();
    // What 0.5.1 does with the seed: takes every field's clock, writes no event (it has no column for it).
    await husband.database.execScript('UPDATE shared_transfers SET event_book_id = NULL');
    expect(await familyRows(s, husband)).toEqual(['partner: ATM withdrawal']);
    // While he is on 0.5.1, nothing more goes, however often her phone runs its repairs.
    expect((await runSharedBookRepairs(wife.database, family)).tripTransfers).toBeNull();

    husband.engine = new SyncEngine(husband.database, husband.transport, husband.keys, undefined, { appVersion: BUILD, shareRecords: husband.records });
    await trip.home.settle();
    // His own pass sends nothing: the row is hers.
    expect((await runSharedBookRepairs(husband.database, family)).tripTransfers).toBe(0);
    expect((await runSharedBookRepairs(wife.database, family)).tripTransfers).toBe(1);
    await trip.home.settle();
    await trip.settle([wife, husband]);
    expect(await skipsOf(husband.database)).toEqual([]);
    expect(await familyRows(s, husband)).toEqual([]);
    expect((await tripOf(s, husband)).transfers.map((t) => t.description)).toEqual(['ATM withdrawal']);
    expect(await projectBook(wife.database, family)).toEqual(await projectBook(husband.database, family));
    // One pass for his crossing: none after.
    expect((await runSharedBookRepairs(wife.database, family)).tripTransfers).toBeNull();
  });

  it('a transfer with its fee on the same row, or one in a workspace no one shares, stays with its reason', async () => {
    const s = await familyAndTrip();
    const fees = await categoryOf(s.wife.database, s.family, 'Bank fees').catch(() => categoryOf(s.wife.database, s.family, 'Groceries'));
    const withFee = await postTransaction(s.wife.database, inBook(s.wife.ws, s.family), {
      occurredOn: '2026-10-08',
      description: 'Move to wallet',
      lines: transferWithFeeLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 500_000, feeMinor: 6_500, currency: 'IDR', feeCategoryId: fees }),
    });
    const business = await createBook(s.wife.database, s.wife.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR' });
    const privateMove = await postTransaction(s.wife.database, inBook(s.wife.ws, business), {
      occurredOn: '2026-10-08',
      description: 'Petty cash',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 70_000, currency: 'IDR' }),
    });
    const { kept, listed, moved } = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [withFee, privateMove]);
    expect(moved).toEqual([]);
    expect(listed).toEqual([]);
    expect(kept).toEqual([
      { transactionId: withFee, why: 'A transfer with a fee on the same row stays: take the fee off first' },
      { transactionId: privateMove, why: 'Only a transfer in a workspace shared with a household moves into a shared event' },
    ]);
  });

  it('a settle-up the trip posted, and a transfer filed in no workspace, each say why they stay', async () => {
    const s = await familyAndTrip();
    const move = (id: string) => moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    const bare = (description: string, fileTransfer: boolean) =>
      postTransaction(s.wife.database, inBook(s.wife.ws, s.family), {
        occurredOn: '2026-10-08',
        description,
        fileTransfer,
        lines: transferLines({ fromAccountId: s.wife.bank, toAccountId: s.wife.cash, amountMinor: 90_000, currency: 'IDR' }),
      });
    // A trip's own settle-up in this phone's books (an event posting).
    const settle = await bare('Settle up', false);
    await s.wife.database.execScript(`INSERT INTO event_postings (book_id, record_id, kind, transaction_id, account_id, account_amount_minor) VALUES ('${s.trip.bookId}', 'settlement-1', 'settlement', '${settle}', NULL, NULL)`);
    expect((await move(settle)).kept[0]!.why).toBe('Already in a shared event');
    // Filed in no workspace: it shows in every one.
    const everywhere = await bare('Pocket money', false);
    expect((await move(everywhere)).kept[0]!.why).toBe('A transfer filed in no workspace shows in every one: only one in a workspace shared with a household moves into a shared event');
  });

  it('a transfer filed in Family before Family was shared (no redacted row: the partner never had it) says so and stays', async () => {
    const trip = new Trip();
    const wife = await trip.device('Wife', BUILD);
    const husband = await trip.device('Husband', BUILD);
    const personal = await personalBook(wife.database, wife.ws);
    const old = await postTransaction(wife.database, inBook(wife.ws, personal.id), {
      occurredOn: '2026-10-08',
      description: 'Old withdrawal',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: wife.bank, toAccountId: wife.cash, amountMinor: 90_000, currency: 'IDR' }),
    });
    const family = await trip.home.share(wife);
    await trip.home.join(husband, wife);
    await trip.home.settle();
    await trip.share(wife);
    await trip.join(husband, wife);
    await trip.settle([wife, husband]);
    // Sharing left it as it was: filed in Family, with no redacted row.
    expect(await wife.database.db.values(sql`SELECT 1 FROM shared_transfers WHERE transaction_id = ${old}`)).toEqual([]);
    expect(await wife.database.db.values(sql`SELECT book_id FROM book_transactions WHERE transaction_id = ${old}`)).toEqual([[family]]);
    const { kept, listed } = await moveIntoSharedEvent(wife.database, ownerScope(wife.ws), trip.eventOf(wife), [old]);
    expect(listed).toEqual([]);
    expect(kept).toEqual([{ transactionId: old, why: 'Recorded before Personal sent its transfers to the household, so the other phones never had it: it stays in Personal' }]);
  });

  it('a purchase beside it still moves as a purchase', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    const category = await categoryOf(s.wife.database, s.family, 'Groceries');
    const snack = await postTransaction(s.wife.database, s.wife.ws, {
      occurredOn: '2026-10-08',
      description: 'Simit',
      lines: expenseLines({ categoryAccountId: category, paymentAccountId: s.wife.bank, amountMinor: 33_600, currency: 'IDR' }),
    });
    await s.settle();
    const { moved, listed, kept } = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id, snack]);
    expect(kept).toEqual([]);
    expect(listed).toEqual([{ transactionId: id }]);
    expect(moved.map((m) => m.transactionId)).toEqual([snack]);
    await s.settle();
    for (const d of [s.wife, s.husband]) {
      const view = await tripOf(s, d);
      expect(view.expenses).toHaveLength(1);
      expect(view.transfers).toHaveLength(1);
      expect(view.spentMinor).toBe(6_000);
    }
  });
});

describe('who must have the trip, and which phones count (review fix round 1)', () => {
  it('stays in Family while someone in Family is not in the trip: there it would show nowhere', async () => {
    const trip = new Trip();
    const wife = await trip.device('Wife', BUILD);
    const husband = await trip.device('Husband', BUILD);
    const family = await trip.home.share(wife);
    await trip.home.join(husband, wife);
    await trip.home.settle();
    await trip.share(wife);
    await trip.settle([wife]);
    const s = { trip, home: trip.home, wife, husband, family, settle: async () => undefined } as unknown as Setup;
    const id = await withdrawal(s);
    const { kept, listed } = await moveIntoSharedEvent(wife.database, ownerScope(wife.ws), trip.eventOf(wife), [id]);
    expect(listed).toEqual([]);
    expect(kept).toEqual([{ transactionId: id, why: "Husband's phone is not in Coast week, so there it would show in neither place" }]);
  });

  it('counts the recorder’s own second phone, and a phone whose version is not known; never a removed one', async () => {
    const s = await familyAndTrip();
    const tablet = await s.home.device('Tablet', 'workspace-Wife', 'IDR', '0.5.1');
    const { code } = await s.wife.engine.linkDevice(s.family, { inviterName: 'Wife' });
    await tablet.engine.joinBook(code, { ws: tablet.ws, memberName: 'Wife', deviceName: 'Tablet' });
    await s.home.settle([s.wife, s.husband, tablet]);
    const id = await withdrawal(s);
    const move = () => moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    expect((await move()).kept[0]!.why).toBe('Update cicis on Tablet first: until then it would stay in Personal there');
    // The tablet is removed from the workspace: it no longer counts.
    await s.wife.database.execScript(`UPDATE book_devices SET removed_at = '2026-11-13T00:00:00Z' WHERE book_id = '${s.family}' AND device_id = '${tablet.deviceId}'`);
    // A phone that has never said its version is taken as an older one.
    await s.wife.database.execScript(`UPDATE book_devices SET app_version = NULL WHERE book_id = '${s.family}' AND device_id = '${s.husband.deviceId}'`);
    expect((await move()).kept[0]!.why).toBe("Update cicis on Husband's phone first: until then it would stay in Personal there");
    await s.wife.database.execScript(`UPDATE book_devices SET app_version = '${BUILD}' WHERE book_id = '${s.family}' AND device_id = '${s.husband.deviceId}'`);
    expect((await move()).listed).toEqual([{ transactionId: id }]);
  });

  it('Remove from event works after the trip is done', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();
    await finishSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), true);
    await s.settle();
    expect(await removeTransferFromSharedEvent(s.wife.database, s.wife.ws, id)).toBe(true);
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
  });

  it('a phone that left the trip, or deleted its copy, lists the transfer in Family again; Remove from event still works', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();
    // The husband leaves the trip: he no longer holds it, so the transfer is back in his Family list.
    await s.husband.engine.leaveEvent(s.trip.bookId);
    await s.trip.settle([s.wife]);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    expect(await familyRows(s, s.wife)).toEqual([]);
    // He deletes his read-only copy: still in his Family list.
    await deleteEventCopy(s.husband.database, s.husband.ws, s.trip.bookId);
    await s.home.settle();
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    // She takes it off the trip (she is the last with the app, so she stays in it): both lists agree again.
    expect(await removeTransferFromSharedEvent(s.wife.database, s.wife.ws, id)).toBe(true);
    await s.home.settle();
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('Remove from event in a copy of Family kept read-only (its owner stopped sharing) is refused in words, and changes nothing', async () => {
    const s = await familyAndTrip();
    // The husband's withdrawal: he records it, so it is his to move and to take off.
    const id = await postTransaction(s.husband.database, inBook(s.husband.ws, s.family), {
      occurredOn: '2026-10-08',
      description: 'ATM withdrawal',
      fileTransfer: true,
      lines: transferLines({ fromAccountId: s.husband.bank, toAccountId: s.husband.cash, amountMinor: 1_120_000, currency: 'IDR' }),
    });
    await s.settle();
    expect((await moveIntoSharedEvent(s.husband.database, ownerScope(s.husband.ws), s.trip.eventOf(s.husband), [id])).listed).toHaveLength(1);
    await s.settle();
    await s.wife.engine.stopSharing(s.family);
    await s.home.settle();
    await expect(removeTransferFromSharedEvent(s.husband.database, s.husband.ws, id)).rejects.toMatchObject({ message: 'This workspace is no longer shared, and is kept read-only' });
    expect(await eventTransferOf(s.husband.database, id)).toMatchObject({ eventName: 'Coast week' });
  });

  it('the recorder who left the trip lists it in Family again, and still takes it off the event', async () => {
    const s = await familyAndTrip();
    const id = await withdrawal(s);
    await s.settle();
    await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [id]);
    await s.settle();
    await s.wife.engine.leaveEvent(s.trip.bookId);
    await s.trip.settle([s.husband]);
    expect(await familyRows(s, s.wife)).toEqual(['ATM withdrawal']);
    expect(await eventTransferOf(s.wife.database, id)).toMatchObject({ eventName: 'Coast week' });
    expect(await removeTransferFromSharedEvent(s.wife.database, s.wife.ws, id)).toBe(true);
    await s.home.settle();
    expect(await familyRows(s, s.husband)).toEqual(['partner: ATM withdrawal']);
    expect((await tripOf(s, s.husband)).transfers).toEqual([]);
  });
});
