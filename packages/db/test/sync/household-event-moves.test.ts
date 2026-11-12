import { expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  confirmDraft,
  convertEventToShared,
  createDraft,
  finishSharedEvent,
  createBook,
  inBook,
  listTransactions,
  moveIntoSharedEvent,
  nativeBalances,
  ownerScope,
  postTransaction,
  replaceTransaction,
  saveEvent,
  sharedEventView,
  suggestForEvent,
  saveEventItem,
  tagTransaction,
  tagTransactions,
} from '../../src/index';
import { categoryOf, headOf, projectBook, type Device } from './household';
import { Trip } from './trip';

/*
 * A shared workspace (Family) and a shared event (Coast week) on the same two phones (sync gaps F0, F2; owner decisions
 * D1 and D3). Invented figures throughout. The wife owns both shares; the husband joins both.
 */

async function familyAndTrip() {
  const trip = new Trip();
  const wife = await trip.device('Wife');
  const husband = await trip.device('Husband');
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

async function groceries(s: Setup, d: Device, description: string, amountMinor: number, occurredOn = '2026-10-06'): Promise<string> {
  const category = await categoryOf(d.database, s.family, 'Groceries');
  return postTransaction(d.database, d.ws, { occurredOn, description, lines: expenseLines({ categoryAccountId: category, paymentAccountId: d.bank, amountMinor, currency: 'IDR' }) });
}

/** The row this phone holds for a lineage (the purchase as it reads here). */
async function copyOf(d: Device, lineageId: string): Promise<string> {
  const head = await headOf(d.database, lineageId);
  if (!head) throw new Error(`no copy of ${lineageId} on ${d.name}`);
  return head;
}

/** What Family's Cashflow reads on a phone for October: the expense total and the rows counted, events left out. */
async function familyOctober(s: Setup, d: Device): Promise<{ total: number; count: number }> {
  const ws = inBook(d.ws, s.family);
  const { rows } = await categoryTotalsIn(d.database, ws, 'expense', '2026-10-01', '2026-10-31', { excludeEvents: true });
  const listed = (await listTransactions(d.database, ws, { from: '2026-10-01', to: '2026-10-31' })).filter((t) => !t.eventId);
  return { total: rows.reduce((sum, r) => sum + r.amountBaseMinor, 0), count: listed.length };
}

describe('F0: a phone never moves the partner’s Family purchase (D3)', () => {
  it('the wife’s phone is refused moving the husband’s purchase; his balance and both phones’ Family stay as they were', async () => {
    const s = await familyAndTrip();
    const his = await groceries(s, s.husband, 'Market', 90_000);
    await s.settle();
    const before = { wife: await projectBook(s.wife.database, s.family), husband: await projectBook(s.husband.database, s.family) };
    expect(before.wife.purchase).toEqual(before.husband.purchase);

    const { moved, kept } = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [await copyOf(s.wife, his)]);
    expect(moved).toEqual([]);
    expect(kept).toEqual([{ transactionId: await copyOf(s.wife, his), why: 'Paid by Husband: moved from Husband’s phone' }]);
    await s.settle();

    expect((await nativeBalances(s.husband.database, s.husband.ws))[s.husband.bank]).toBe(-90_000);
    expect(await headOf(s.husband.database, his)).toBe(his);
    expect(await projectBook(s.wife.database, s.family)).toEqual(before.wife);
    expect(await projectBook(s.husband.database, s.family)).toEqual(before.husband);
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
    expect((await sharedEventView(s.husband.database, ownerScope(s.husband.ws), s.trip.eventOf(s.husband)))!.expenses).toEqual([]);
  });

  it('nor tags it, by one row or a selection', async () => {
    const s = await familyAndTrip();
    const his = await groceries(s, s.husband, 'Market', 90_000);
    await s.settle();
    const copy = await copyOf(s.wife, his);
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    await expect(tagTransaction(s.wife.database, s.wife.ws, copy, own)).rejects.toMatchObject({ code: 'SHARED_WORKSPACE' });
    await expect(tagTransactions(s.wife.database, s.wife.ws, [copy], own)).rejects.toMatchObject({ code: 'SHARED_WORKSPACE' });

  });

  it('nor moves it to another of her workspaces (Move to workspace voids it in Family as a move into an event would)', async () => {
    const s = await familyAndTrip();
    const his = await groceries(s, s.husband, 'Market', 90_000);
    await s.settle();
    const copy = await copyOf(s.wife, his);
    const business = await createBook(s.wife.database, s.wife.ws, { name: 'Business', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: s.family });
    const there = await categoryOf(s.wife.database, business, 'Groceries');
    const [money] = await s.wife.database.db.values<[string]>(sql`
      SELECT e.account_id FROM entries e JOIN accounts a ON a.id = e.account_id WHERE e.transaction_id = ${copy} AND a.kind = 'asset'`);
    await expect(
      replaceTransaction(s.wife.database, s.wife.ws, copy, {
        occurredOn: '2026-10-06', description: 'Market', moveToBook: true, toBookId: business,
        lines: expenseLines({ categoryAccountId: there, paymentAccountId: money![0], amountMinor: 90_000, currency: 'IDR' }),
      }),
    ).rejects.toMatchObject({ code: 'PAID_BY_PARTNER', message: 'Paid by Husband: moved from Husband’s phone' });
    await s.settle();
    expect((await nativeBalances(s.husband.database, s.husband.ws))[s.husband.bank]).toBe(-90_000);
    expect(await headOf(s.husband.database, his)).toBe(his);
  });

  it('the payer’s own phone moves it: it leaves Family on both phones, and the event lists it as his', async () => {
    const s = await familyAndTrip();
    const his = await groceries(s, s.husband, 'Market', 90_000);
    await s.settle();
    const { moved, kept } = await moveIntoSharedEvent(s.husband.database, ownerScope(s.husband.ws), s.trip.eventOf(s.husband), [his]);
    expect(kept).toEqual([]);
    expect(moved).toHaveLength(1);
    await s.settle();
    expect(await headOf(s.wife.database, his)).toBeNull();
    expect(await headOf(s.husband.database, his)).toBeNull();
    expect(await familyOctober(s, s.wife)).toEqual({ total: 0, count: 0 });
    expect(await familyOctober(s, s.husband)).toEqual({ total: 0, count: 0 });
    // His bank paid it, as before: only where it is filed changed.
    expect((await nativeBalances(s.husband.database, s.husband.ws))[s.husband.bank]).toBe(-90_000);
    for (const d of [s.wife, s.husband]) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.expenses.map((e) => [e.expenseId, e.note])).toEqual([[moved[0]!.expenseId, 'Market']]);
    }
  });
});

describe('F2: a Family purchase never carries an event tag (D1)', () => {
  it('a tag to a private event, or to the shared one without moving, is refused at every door', async () => {
    const s = await familyAndTrip();
    const hers = await groceries(s, s.wife, 'Bakery', 40_000);
    await s.settle();
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    const category = await categoryOf(s.wife.database, s.family, 'Groceries');
    const lines = expenseLines({ categoryAccountId: category, paymentAccountId: s.wife.bank, amountMinor: 40_000, currency: 'IDR' });
    for (const eventId of [own, s.trip.eventOf(s.wife)]) {
      await expect(tagTransaction(s.wife.database, s.wife.ws, hers, eventId)).rejects.toMatchObject({ code: 'SHARED_WORKSPACE' });
      await expect(tagTransactions(s.wife.database, s.wife.ws, [hers], eventId)).rejects.toMatchObject({ code: 'SHARED_WORKSPACE' });
      await expect(replaceTransaction(s.wife.database, s.wife.ws, hers, { occurredOn: '2026-10-06', description: 'Bakery', eventId, lines })).rejects.toMatchObject({ code: 'SHARED_EVENT_TAG' });
      await expect(postTransaction(s.wife.database, s.wife.ws, { occurredOn: '2026-10-07', description: 'Cake', eventId, lines })).rejects.toMatchObject({ code: 'SHARED_EVENT_TAG' });
    }
    await s.settle();
    const tagged = await s.wife.database.db.values(sql`SELECT id FROM transactions WHERE event_id IS NOT NULL`);
    expect(tagged).toEqual([]);
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
    expect(await familyOctober(s, s.wife)).toEqual({ total: 40_000, count: 1 });
  });

  it('a private event never suggests a Family purchase', async () => {
    const s = await familyAndTrip();
    await groceries(s, s.wife, 'Bakery', 40_000);
    await s.settle();
    const groceriesId = await categoryOf(s.wife.database, s.family, 'Groceries');
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    await saveEventItem(s.wife.database, ownerScope(s.wife.ws), own, { name: 'Cake', unitPriceMinor: 50_000, categoryAccountId: groceriesId });
    expect(await suggestForEvent(s.wife.database, s.wife.ws, own)).toEqual([]);
  });

  it('a move refused for want of a rate leaves the purchase untagged and in Family on both phones', async () => {
    const s = await familyAndTrip();
    // Paid in dollars: neither phone has a dollar rate stored to convert it to lira.
    const category = await categoryOf(s.wife.database, s.family, 'Groceries');
    const early = await postTransaction(s.wife.database, s.wife.ws, {
      occurredOn: '2026-10-06', description: 'Duty free', ratesToBase: { USD: 16_000 },
      lines: expenseLines({ categoryAccountId: category, paymentAccountId: s.wife.usd, amountMinor: 2_500, currency: 'USD' }),
    });
    await s.settle();
    const { moved, kept } = await moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), [early]);
    expect(moved).toEqual([]);
    expect(kept[0]!.why).toMatch(/rate/);
    const [row] = await s.wife.database.db.values<[string | null, string]>(sql`SELECT event_id, status FROM transactions WHERE id = ${early}`);
    expect(row).toEqual([null, 'posted']);
    await s.settle();
    expect(await headOf(s.husband.database, early)).not.toBeNull();
  });

  it('sharing an event that Family purchases are tagged to moves the payer’s own, and untags what cannot move', async () => {
    const s = await familyAndTrip();
    const hers = await groceries(s, s.wife, 'Bazaar snacks', 60_000);
    const category = await categoryOf(s.wife.database, s.family, 'Groceries');
    const dollars = await postTransaction(s.wife.database, s.wife.ws, {
      occurredOn: '2026-10-06', description: 'Bazaar stall', ratesToBase: { USD: 16_000 },
      lines: expenseLines({ categoryAccountId: category, paymentAccountId: s.wife.usd, amountMinor: 1_000, currency: 'USD' }),
    });
    const his = await groceries(s, s.husband, 'Bazaar parking', 10_000);
    await s.settle();
    const bazaar = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Bazaar', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    // Tags from an older build, before Family's spending was refused one.
    for (const id of [hers, dollars, await copyOf(s.wife, his)]) await s.wife.database.db.run(sql`UPDATE transactions SET event_id = ${bazaar} WHERE id = ${id}`);
    await s.wife.engine.shareEvent(ownerScope(s.wife.ws), { eventId: bazaar, currency: 'IDR', personName: 'Wife', deviceName: 'Wife’s phone', names: [] });
    const { moved, kept } = await convertEventToShared(s.wife.database, ownerScope(s.wife.ws), bazaar);
    expect(moved).toBe(1);
    expect(kept.map((k) => k.transactionId).sort()).toEqual([dollars, await copyOf(s.wife, his)].sort());
    const tagged = await s.wife.database.db.values(sql`SELECT id FROM transactions WHERE event_id IS NOT NULL AND status = 'posted'
      AND id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${s.family})`);
    expect(tagged).toEqual([]);
    await s.settle();
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
  });

  it('an edit of a purchase still carrying a tag from an older build drops the tag, so both phones count it', async () => {
    const s = await familyAndTrip();
    const hers = await groceries(s, s.wife, 'Bakery', 40_000);
    await s.settle();
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    await s.wife.database.db.run(sql`UPDATE transactions SET event_id = ${own} WHERE id = ${hers}`);
    const category = await categoryOf(s.wife.database, s.family, 'Groceries');
    const edited = await replaceTransaction(s.wife.database, s.wife.ws, hers, {
      occurredOn: '2026-10-06', description: 'Bakery and coffee', lines: expenseLines({ categoryAccountId: category, paymentAccountId: s.wife.bank, amountMinor: 45_000, currency: 'IDR' }),
    });
    const [row] = await s.wife.database.db.values<[string | null]>(sql`SELECT event_id FROM transactions WHERE id = ${edited}`);
    expect(row).toEqual([null]);
    await s.settle();
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
  });
});

describe('fix round 1: doors that save first, then move or drop the tag (#5, #6)', () => {
  it('a draft confirmed in Family into the shared event moves there; one refused, or a private event, saves in Family with why', async () => {
    const s = await familyAndTrip();
    const category = await categoryOf(s.wife.database, s.family, 'Groceries');
    const draft = (description: string, accountId = s.wife.bank, currency = 'IDR', amountMinor = 55_000) =>
      createDraft(s.wife.database, s.wife.ws, { source: 'screen', occurredOn: '2026-10-06', description, amountMinor, currency, accountId, categoryAccountId: category });
    const moved = await confirmDraft(s.wife.database, s.wife.ws, await draft('Kebab'), { extras: { eventId: s.trip.eventOf(s.wife) } });
    expect(moved.notMoved).toBeNull();
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    const privately = await confirmDraft(s.wife.database, s.wife.ws, await draft('Cake'), { extras: { eventId: own } });
    expect(privately.notMoved).toBe('Event tag removed: Personal spending can’t be in a private event.');
    // The trip is called done meanwhile: nothing more moves into it.
    await finishSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), true);
    const refused = await confirmDraft(s.wife.database, s.wife.ws, await draft('Duty free'), { extras: { eventId: s.trip.eventOf(s.wife) } });
    expect(refused.notMoved).toBe('Saved in Personal. Not moved into Coast week: Coast week is done. Reopen it to change anything.');
    await s.settle();
    expect(await s.wife.database.db.values(sql`SELECT id FROM transactions WHERE event_id IS NOT NULL AND status = 'posted' AND id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${s.family})`)).toEqual([]);
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
    expect((await familyOctober(s, s.wife)).count).toBe(2);
    const view = (await sharedEventView(s.husband.database, ownerScope(s.husband.ws), s.trip.eventOf(s.husband)))!;
    expect(view.expenses.map((e) => e.note)).toEqual(['Kebab']);
  });

  it('Move to workspace into Family drops a private event tag and says so', async () => {
    const s = await familyAndTrip();
    const side = await createBook(s.wife.database, s.wife.ws, { name: 'Side job', kind: 'business', baseCurrency: 'IDR', copyCategoriesFrom: s.family });
    const there = await categoryOf(s.wife.database, side, 'Groceries');
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    const cake = await postTransaction(s.wife.database, inBook(s.wife.ws, side), {
      occurredOn: '2026-10-06', description: 'Cake', eventId: own, lines: expenseLines({ categoryAccountId: there, paymentAccountId: s.wife.bank, amountMinor: 70_000, currency: 'IDR' }),
    });
    const family = await categoryOf(s.wife.database, s.family, 'Groceries');
    const moved = await replaceTransaction(s.wife.database, inBook(s.wife.ws, side), cake, {
      occurredOn: '2026-10-06', description: 'Cake', moveToBook: true, toBookId: s.family, eventId: own,
      lines: expenseLines({ categoryAccountId: family, paymentAccountId: s.wife.bank, amountMinor: 70_000, currency: 'IDR' }),
    });
    const [row] = await s.wife.database.db.values<[string | null]>(sql`SELECT event_id FROM transactions WHERE id = ${moved}`);
    expect(row).toEqual([null]);
    await s.settle();
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
  });

  it('the partner’s purchase can be untagged on this phone: the tag lived here alone', async () => {
    const s = await familyAndTrip();
    const his = await groceries(s, s.husband, 'Market', 90_000);
    await s.settle();
    const copy = await copyOf(s.wife, his);
    const own = await saveEvent(s.wife.database, ownerScope(s.wife.ws), { name: 'Birthday', startsOn: '2026-10-01', endsOn: '2026-10-31' });
    await s.wife.database.db.run(sql`UPDATE transactions SET event_id = ${own} WHERE id = ${copy}`);
    await tagTransaction(s.wife.database, s.wife.ws, copy, null);
    const [row] = await s.wife.database.db.values<[string | null]>(sql`SELECT event_id FROM transactions WHERE id = ${copy}`);
    expect(row).toEqual([null]);
    await s.settle();
    expect(await familyOctober(s, s.wife)).toEqual(await familyOctober(s, s.husband));
  });
});
