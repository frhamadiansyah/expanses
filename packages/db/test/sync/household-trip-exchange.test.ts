import { exchangeLines, exchangeWithFeeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  categoryTotalsIn,
  createAccount,
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
  sharedEventOf,
  sharedEventView,
  voidTransaction,
} from '../../src/index';
import { categoryOf, projectBook, skipsOf, type Device } from './household';
import { Trip } from './trip';

/*
 * A cross-currency withdrawal in Family moved into the shared trip (trip withdrawal, owner's report on build 122): cash in
 * rupiah exchanged into lira cash at an ATM abroad, the rate off the market's, so the row carries the app's own Currency
 * Exchange lines (the spread) beside the two cash accounts — no fee, no category. Invented figures throughout:
 * TRY 2.500,00 for Rp 1.450.000 at "Bank Contoh ATM" (the trip's market rate is 560, `Trip`).
 */

const BUILD = '0.5.2';

interface Setup {
  trip: Trip;
  wife: Device;
  husband: Device;
  family: string;
  lira: string;
  exchange: string;
  settle: () => Promise<void>;
}

async function walletOf(d: Device): Promise<{ lira: string; exchange: string }> {
  const lira = (await createAccount(d.database, d.ws, { name: `${d.name} Lira`, kind: 'asset', subtype: 'cash', currency: 'TRY' })).id;
  const [exchange] = await d.database.db.values<[string]>(sql`SELECT id FROM accounts WHERE system_key = 'currency_exchange' AND workspace_id = ${d.ws.workspaceId}`);
  return { lira, exchange: exchange![0] };
}

/** Family shared, both phones in it and in the trip; `before` runs on the wife's phone before Family is shared. */
async function familyAndTrip(before?: (wife: Device, lira: string, exchange: string, family: string) => Promise<void>): Promise<Setup> {
  const trip = new Trip();
  const wife = await trip.device('Wife', BUILD);
  const husband = await trip.device('Husband', BUILD);
  const { lira, exchange } = await walletOf(wife);
  if (before) await before(wife, lira, exchange, (await personalBook(wife.database, wife.ws)).id);
  const family = await trip.home.share(wife);
  await trip.home.join(husband, wife);
  await trip.home.settle();
  await trip.share(wife);
  await trip.join(husband, wife);
  await trip.settle([wife, husband]);
  const settle = async () => {
    await trip.home.settle();
    await trip.settle([wife, husband]);
    await trip.home.settle();
  };
  return { trip, wife, husband, family, lira, exchange, settle };
}

/** The ATM abroad: Rp 1.450.000 out of the rupiah wallet, TRY 2.500,00 into the lira one, the spread on Currency Exchange. */
function atm(wife: Device, family: string, lira: string, exchange: string, feeCategoryId?: string): Promise<string> {
  const leg = { fromAccountId: wife.cash, fromAmountMinor: 1_450_000, fromCurrency: 'IDR', toAccountId: lira, toAmountMinor: 250_000, toCurrency: 'TRY', exchangeAccountId: exchange };
  return postTransaction(wife.database, inBook(wife.ws, family), {
    occurredOn: '2026-10-06',
    description: 'Bank Contoh ATM',
    fileTransfer: true,
    ratesToBase: { TRY: 560 },
    lines: feeCategoryId ? exchangeWithFeeLines({ ...leg, feeMinor: 25_000, feeCategoryId }) : exchangeLines(leg),
  });
}

/** What Family's Cashflow lists on a phone for October: its own rows and the partner's transfers. */
async function familyRows(s: Setup, d: Device): Promise<string[]> {
  const own = (await listTransactions(d.database, inBook(d.ws, s.family), { from: '2026-10-01', to: '2026-10-31' })).map((t) => t.description);
  const partner = (await listSharedTransfers(d.database, s.family, { from: '2026-10-01', to: '2026-10-31' })).map((t) => `partner: ${t.description} ${t.amountMinor} ${t.currency}`);
  return [...own, ...partner].sort();
}

/** What Family counts as spending in October on a phone, events left out: the expense categories' total. */
async function familySpend(s: Setup, d: Device): Promise<number> {
  const { rows } = await categoryTotalsIn(d.database, inBook(d.ws, s.family), 'expense', '2026-10-01', '2026-10-31', { excludeEvents: true });
  return rows.reduce((sum, r) => sum + r.amountBaseMinor, 0);
}

const pick = (balances: Record<string, number>, ids: readonly string[]) => Object.fromEntries(ids.map((id) => [id, balances[id] ?? 0]));

/**
 * Select → Add to event on the Cashflow list, as `TransactionsPage.tagChosen` runs it once the confirm is answered: the
 * event read from the database (a shared one, so the rows move), then every chosen row handed to the move.
 */
async function addToTrip(s: Setup, ids: string[]) {
  const target = await sharedEventOf(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife));
  expect(target).not.toBeNull();
  return moveIntoSharedEvent(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife), ids);
}

/** Every chosen id comes back exactly once, as moved, listed or kept with a reason: nothing is ever dropped silently. */
function expectAccounted(ids: readonly string[], result: Awaited<ReturnType<typeof moveIntoSharedEvent>>) {
  const said = [...result.moved.map((m) => m.transactionId), ...result.listed.map((l) => l.transactionId), ...result.kept.map((k) => k.transactionId)];
  expect([...said].sort()).toEqual([...new Set(ids)].sort());
  for (const k of result.kept) expect(k.why.trim()).not.toBe('');
}

describe('a cross-currency withdrawal in Family moved into the shared trip', () => {
  it('is listed whole on the trip, not counted, off Family on both phones; the partner reads the lira that landed', async () => {
    const s = await familyAndTrip();
    const id = await atm(s.wife, s.family, s.lira, s.exchange);
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['Bank Contoh ATM']);
    // The partner reads what landed in the lira wallet, never the rupiah figure the spread line carries.
    expect(await familyRows(s, s.husband)).toEqual(['partner: Bank Contoh ATM 250000 TRY']);
    const before = await nativeBalances(s.wife.database, s.wife.ws);

    const result = await addToTrip(s, [id]);
    expect(result).toEqual({ moved: [], kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    expect(await skipsOf(s.wife.database)).toEqual([]);

    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
    // Untouched: posted, every line as it was, balances unchanged.
    expect(await s.wife.database.db.values(sql`SELECT status FROM transactions WHERE id = ${id}`)).toEqual([['posted']]);
    expect(await nativeBalances(s.wife.database, s.wife.ws)).toEqual(before);
    for (const d of [s.wife, s.husband]) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers.map((t) => [t.occurredOn, t.description, t.amountMinor, t.currency, t.recordedByName])).toEqual([['2026-10-06', 'Bank Contoh ATM', 250_000, 'TRY', 'Wife']]);
      expect(view.expenses).toEqual([]);
      expect(view.spentMinor).toBe(0);
      expect(view.people.every((p) => p.balanceMinor === 0)).toBe(true);
    }
    // The recorder's phone names its own two wallets, the rupiah one the money left and the lira one it reached.
    expect((await sharedEventView(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife)))!.transfers[0]).toMatchObject({
      transactionId: id,
      fromName: 'Wife Wallet',
      toName: 'Wife Lira',
    });
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('deleted once listed, it is gone from the trip and from Family on both phones', async () => {
    const s = await familyAndTrip();
    const id = await atm(s.wife, s.family, s.lira, s.exchange);
    await s.settle();
    await addToTrip(s, [id]);
    await s.settle();
    await voidTransaction(s.wife.database, inBook(s.wife.ws, s.family), id);
    await s.settle();
    for (const d of [s.wife, s.husband]) expect((await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!.transfers).toEqual([]);
    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
  });

  it('the owner’s row: filed in Family as a purchase (before Family sent its transfers), moved, is listed and leaves Family on both phones', async () => {
    let id = '';
    const s = await familyAndTrip(async (wife, lira, exchange, family) => {
      id = await atm(wife, family, lira, exchange);
    });
    // The owner's receipt reads "Paid with … + Currency Exchange + …": it travels as a purchase, with no redacted row.
    expect(await s.wife.database.db.values(sql`SELECT paid_label FROM sync_lineage WHERE head_transaction_id = ${id}`)).toEqual([['Wife Wallet + Currency Exchange + Wife Lira']]);
    expect(await s.wife.database.db.values(sql`SELECT 1 FROM shared_transfers WHERE transaction_id = ${id}`)).toEqual([]);
    const before = await nativeBalances(s.wife.database, s.wife.ws);
    // The husband's phone never took the purchase copy (no category line: TOO_FEW_LINES), as build 122 said.
    const skipped = await skipsOf(s.husband.database);

    const result = await addToTrip(s, [id]);
    expect(result).toEqual({ moved: [], kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    // Nothing more is skipped: the void and the redacted row apply.
    expect(await skipsOf(s.husband.database)).toEqual(skipped);
    expect(await skipsOf(s.wife.database)).toEqual([]);
    // Off Family on both phones: the purchase the partner held goes, and nothing stands in for it in the list.
    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
    for (const d of [s.wife, s.husband]) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers.map((t) => [t.description, t.amountMinor, t.currency])).toEqual([['Bank Contoh ATM', 250_000, 'TRY']]);
      expect(view.spentMinor).toBe(0);
      expect(await familySpend(s, d)).toBe(0);
    }
    expect(await s.wife.database.db.values(sql`SELECT status FROM transactions WHERE id = ${id}`)).toEqual([['posted']]);
    expect(await nativeBalances(s.wife.database, s.wife.ws)).toEqual(before);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));

    // Remove from event: back in Family on both phones, as a transfer now, still counted nowhere.
    expect(await removeTransferFromSharedEvent(s.wife.database, inBook(s.wife.ws, s.family), id)).toBe(true);
    await s.settle();
    expect(await familyRows(s, s.wife)).toEqual(['Bank Contoh ATM']);
    expect(await familyRows(s, s.husband)).toEqual(['partner: Bank Contoh ATM 250000 TRY']);
    for (const d of [s.wife, s.husband]) expect(await familySpend(s, d)).toBe(0);
    expect(await nativeBalances(s.wife.database, s.wife.ws)).toEqual(before);
  });

  it('a row synced with the old rupiah figure (build 122), moved: the partner and the trip read the lira that landed, once', async () => {
    const s = await familyAndTrip();
    const id = await atm(s.wife, s.family, s.lira, s.exchange);
    await s.settle();
    // What build 122 wrote on both phones: the rupiah the spread line holds, not the lira.
    for (const d of [s.wife, s.husband]) await d.database.db.run(sql`UPDATE shared_transfers SET amount_minor = 1450000, currency = 'IDR' WHERE book_id = ${s.family}`);
    expect(await familyRows(s, s.husband)).toEqual(['partner: Bank Contoh ATM 1450000 IDR']);

    expect(await addToTrip(s, [id])).toEqual({ moved: [], kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    for (const d of [s.wife, s.husband]) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers.map((t) => [t.description, t.amountMinor, t.currency])).toEqual([['Bank Contoh ATM', 250_000, 'TRY']]);
      expect(view.expenses).toEqual([]);
      expect(view.spentMinor).toBe(0);
    }
    expect(await familyRows(s, s.husband)).toEqual([]);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('the rate gap (Currency Exchange lines) counts nowhere: not in Family, not on the trip, before, after and once removed', async () => {
    const s = await familyAndTrip();
    const id = await atm(s.wife, s.family, s.lira, s.exchange);
    await s.settle();
    const before = await nativeBalances(s.wife.database, s.wife.ws);
    for (const d of [s.wife, s.husband]) expect(await familySpend(s, d)).toBe(0);
    await addToTrip(s, [id]);
    await s.settle();
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(0);
      expect((await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!.spentMinor).toBe(0);
    }
    expect(await removeTransferFromSharedEvent(s.wife.database, inBook(s.wife.ws, s.family), id)).toBe(true);
    await s.settle();
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(0);
      expect((await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!.transfers).toEqual([]);
    }
    expect(await familyRows(s, s.husband)).toEqual(['partner: Bank Contoh ATM 250000 TRY']);
    expect(await nativeBalances(s.wife.database, s.wife.ws)).toEqual(before);
  });

  it('a typed fee moves with it and counts once, on the trip, as a fee; Family no longer counts it; Remove from event puts both back', async () => {
    const s = await familyAndTrip();
    const fees = await categoryOf(s.wife.database, s.family, 'Fees & charges');
    const id = await atm(s.wife, s.family, s.lira, s.exchange, fees);
    await s.settle();
    const before = await nativeBalances(s.wife.database, s.wife.ws);
    // Before: the fee is Family spending on both phones, and the row is one row.
    for (const d of [s.wife, s.husband]) expect(await familySpend(s, d)).toBe(25_000);
    expect(await familyRows(s, s.wife)).toEqual(['Bank Contoh ATM']);

    const result = await addToTrip(s, [id]);
    expect(result).toEqual({ moved: [], kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    expect(await skipsOf(s.wife.database)).toEqual([]);
    expect(await familyRows(s, s.wife)).toEqual([]);
    expect(await familyRows(s, s.husband)).toEqual([]);
    // Rp 25.000 at 560 a lira: TRY 44,64.
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(0);
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers.map((t) => [t.description, t.amountMinor, t.currency])).toEqual([['Bank Contoh ATM', 250_000, 'TRY']]);
      expect(view.expenses.map((e) => [e.note, e.amountMinor, e.currency, e.categoryName])).toEqual([['Bank Contoh ATM', 25_000, 'IDR', 'Fees & charges']]);
      expect(view.spentMinor).toBe(4_464);
    }
    // Every account holds what it held: the rupiah wallet still paid the fee, once.
    expect(await nativeBalances(s.wife.database, s.wife.ws)).toMatchObject(pick(before, [s.wife.cash, s.lira, s.exchange]));
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));

    // Remove from event: the transfer and its fee are one Family row again, counted in Family on both phones; the trip
    // has neither.
    const listed = (await sharedEventView(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife)))!.transfers[0]!.transactionId!;
    expect(await removeTransferFromSharedEvent(s.wife.database, inBook(s.wife.ws, s.family), listed)).toBe(true);
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    // One row again on both phones: the recorder's own, and the partner's copy of the purchase it is once more.
    expect(await familyRows(s, s.wife)).toEqual(['Bank Contoh ATM']);
    expect(await familyRows(s, s.husband)).toEqual(['Bank Contoh ATM']);
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(25_000);
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers).toEqual([]);
      expect(view.spentMinor).toBe(0);
    }
    expect(pick(await nativeBalances(s.wife.database, s.wife.ws), [s.wife.cash, s.lira, s.exchange])).toEqual(pick(before, [s.wife.cash, s.lira, s.exchange]));
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });
});

describe('lira changed back with a lira fee typed beside it (owner, 17 Nov 2026)', () => {
  it('counts the fee alone in Family on both phones, the rate nowhere; moved to the trip, the fee counts there alone', async () => {
    const s = await familyAndTrip();
    const fees = await categoryOf(s.wife.database, s.family, 'Fees & charges');
    // TRY 2.500 bought for Rp 1.450.000 (580 a lira), then TRY 1.000 changed back for Rp 540.000 with a TRY 50 fee.
    await atm(s.wife, s.family, s.lira, s.exchange);
    const id = await postTransaction(s.wife.database, inBook(s.wife.ws, s.family), {
      occurredOn: '2026-10-08',
      description: 'Kiosk change back',
      fileTransfer: true,
      ratesToBase: { TRY: 560 },
      lines: exchangeWithFeeLines({ fromAccountId: s.lira, fromAmountMinor: 100_000, fromCurrency: 'TRY', toAccountId: s.wife.cash, toAmountMinor: 540_000, toCurrency: 'IDR', exchangeAccountId: s.exchange, feeMinor: 5_000, feeCategoryId: fees }),
    });
    // TRY 10 changed back for Rp 5.000 the next day, no fee: Exchange loss is made here and reaches the partner before
    // the move below. Made during the move instead, it reaches the partner after the row that uses it, which files it
    // as Uncategorised there (a separate fault, found here and reported; the same on main).
    await postTransaction(s.wife.database, inBook(s.wife.ws, s.family), {
      occurredOn: '2026-10-09',
      description: 'Kiosk small change',
      fileTransfer: true,
      ratesToBase: { TRY: 560 },
      lines: exchangeLines({ fromAccountId: s.lira, fromAmountMinor: 1_000, fromCurrency: 'TRY', toAccountId: s.wife.cash, toAmountMinor: 5_000, toCurrency: 'IDR', exchangeAccountId: s.exchange }),
    });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    /** The fee line's figure on a phone: TRY 50 at 580 a lira, not the Rp 40.000 the kiosk's rate kept on top. */
    const feeBase = async (d: Device) =>
      (await d.database.db.values<[number]>(sql`
        SELECT e.amount_base_minor FROM entries e JOIN transactions t ON t.id = e.transaction_id
        WHERE t.status = 'posted' AND t.description = 'Kiosk change back' AND e.account_id = ${fees}`)).map(([base]) => Number(base));
    expect(await feeBase(s.wife)).toEqual([29_000]);
    expect(await feeBase(s.husband)).toEqual([29_000]);
    for (const d of [s.wife, s.husband]) expect(await familySpend(s, d)).toBe(29_000);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));

    const before = await money(s);
    const result = await addToTrip(s, [id]);
    expect(result).toEqual({ moved: [], kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(0);
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.expenses.map((e) => [e.note, e.amountMinor, e.currency, e.categoryName])).toEqual([['Kiosk change back', 5_000, 'TRY', 'Fees & charges']]);
      // TRY 50 on a lira trip: the fee alone.
      expect(view.spentMinor).toBe(5_000);
    }
    // The money accounts hold what they held. (Off Family, the change is in no workspace and takes the withdrawal rate's
    // pair: its gap moves off Currency Exchange onto the pair, both counting nowhere.)
    const held = (m: Record<string, number>) => pick(m, [s.wife.cash, s.wife.bank, s.lira]);
    expect(held(await money(s))).toEqual(held(before));
  });
});

/** The transfer row a phone's trip lists, on the recorder's phone: the transaction it stands as now. */
async function listedOn(s: Setup): Promise<string> {
  return (await sharedEventView(s.wife.database, ownerScope(s.wife.ws), s.trip.eventOf(s.wife)))!.transfers[0]!.transactionId!;
}

/** Money accounts only: what the move and Remove must leave exactly as they found them. */
async function money(s: Setup): Promise<Record<string, number>> {
  return pick(await nativeBalances(s.wife.database, s.wife.ws), [s.wife.cash, s.wife.bank, s.lira, s.exchange]);
}

describe('a typed fee taken back off the trip (review fix)', () => {
  it('moved, removed and moved again: listed again, the fee counted once on the trip; removed again, all as before', async () => {
    const s = await familyAndTrip();
    const fees = await categoryOf(s.wife.database, s.family, 'Fees & charges');
    const id = await atm(s.wife, s.family, s.lira, s.exchange, fees);
    await s.settle();
    const before = await money(s);
    expect(await addToTrip(s, [id])).toMatchObject({ kept: [], listed: [{ transactionId: id }] });
    await s.settle();
    expect(await removeTransferFromSharedEvent(s.wife.database, inBook(s.wife.ws, s.family), await listedOn(s))).toBe(true);
    await s.settle();
    const back = (await listTransactions(s.wife.database, inBook(s.wife.ws, s.family), { from: '2026-10-01', to: '2026-10-31' }))[0]!.id;

    const again = await addToTrip(s, [back]);
    expect(again).toEqual({ moved: [], kept: [], listed: [{ transactionId: back }] });
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    for (const d of [s.wife, s.husband]) {
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers).toHaveLength(1);
      // The first move's fee stays voided on the trip; the second is its own record, live.
      expect(view.expenses.map((e) => [e.note, e.amountMinor, e.currency, e.voided]).sort((a, b) => Number(b[3]) - Number(a[3]))).toEqual([
        ['Bank Contoh ATM', 25_000, 'IDR', true],
        ['Bank Contoh ATM', 25_000, 'IDR', false],
      ]);
      expect(view.spentMinor).toBe(4_464);
      expect(await familySpend(s, d)).toBe(0);
    }
    expect(await money(s)).toEqual(before);

    expect(await removeTransferFromSharedEvent(s.wife.database, inBook(s.wife.ws, s.family), await listedOn(s))).toBe(true);
    await s.settle();
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(25_000);
      expect((await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!.spentMinor).toBe(0);
    }
    expect(await familyRows(s, s.wife)).toEqual(['Bank Contoh ATM']);
    expect(await money(s)).toEqual(before);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });

  it('edited while listed to come from another account, then removed: the fee is never lost, and Remove moves no money', async () => {
    const s = await familyAndTrip();
    const fees = await categoryOf(s.wife.database, s.family, 'Fees & charges');
    const id = await atm(s.wife, s.family, s.lira, s.exchange, fees);
    await s.settle();
    await addToTrip(s, [id]);
    await s.settle();
    // The listed transfer now says the rupiah came out of the bank account, not the wallet the fee was paid from.
    await replaceTransaction(s.wife.database, inBook(s.wife.ws, s.family), await listedOn(s), {
      occurredOn: '2026-10-06',
      description: 'Bank Contoh ATM',
      ratesToBase: { TRY: 560 },
      lines: exchangeLines({ fromAccountId: s.wife.bank, fromAmountMinor: 1_450_000, fromCurrency: 'IDR', toAccountId: s.lira, toAmountMinor: 250_000, toCurrency: 'TRY', exchangeAccountId: s.exchange }),
    });
    await s.settle();
    const edited = await money(s);

    expect(await removeTransferFromSharedEvent(s.wife.database, inBook(s.wife.ws, s.family), await listedOn(s))).toBe(true);
    await s.settle();
    expect(await skipsOf(s.husband.database)).toEqual([]);
    // Every account as it was the moment before Remove: the fee is back as spending, still paid from the wallet.
    expect(await money(s)).toEqual(edited);
    for (const d of [s.wife, s.husband]) {
      expect(await familySpend(s, d)).toBe(25_000);
      const view = (await sharedEventView(d.database, ownerScope(d.ws), s.trip.eventOf(d)))!;
      expect(view.transfers).toEqual([]);
      expect(view.spentMinor).toBe(0);
    }
    expect((await familyRows(s, s.wife)).sort()).toEqual(['Bank Contoh ATM', 'Bank Contoh ATM']);
    expect(await projectBook(s.wife.database, s.family)).toEqual(await projectBook(s.husband.database, s.family));
  });
});

describe('only a transfer’s shape is filed as a transfer when moved (review fix)', () => {
  it('a no-category row filed in Family that is no transfer (a holding bought) stays, with a reason', async () => {
    let id = '';
    const s = await familyAndTrip(async (wife, _lira, _exchange, family) => {
      const shares = (await createAccount(wife.database, wife.ws, { name: 'Contoh shares', kind: 'asset', subtype: 'investment', currency: 'IDR' })).id;
      id = await postTransaction(wife.database, inBook(wife.ws, family), {
        occurredOn: '2026-10-06',
        description: 'Buy Contoh',
        fileTransfer: true,
        lines: [
          { accountId: wife.bank, amountMinor: -500_000, currency: 'IDR' },
          { accountId: shares, amountMinor: 500_000, currency: 'IDR' },
        ],
      });
    });
    const result = await addToTrip(s, [id]);
    expectAccounted([id], result);
    expect(result.listed).toEqual([]);
    expect(result.kept).toEqual([{ transactionId: id, why: 'Only a purchase from one account under one category moves into a shared event' }]);
    expect(await s.wife.database.db.values(sql`SELECT 1 FROM shared_transfers WHERE transaction_id = ${id}`)).toEqual([]);
  });
});

describe('Add to event never drops a chosen row silently', () => {
  it('a mixed choice comes back whole: each row moved, listed, or kept with its reason', async () => {
    let early = '';
    const s = await familyAndTrip(async (wife, lira, exchange, family) => {
      early = await atm(wife, family, lira, exchange);
    });
    const listedOne = await atm(s.wife, s.family, s.lira, s.exchange);
    const fees = await categoryOf(s.wife.database, s.family, 'Groceries');
    const withFee = await atm(s.wife, s.family, s.lira, s.exchange, fees);
    const snack = await postTransaction(s.wife.database, inBook(s.wife.ws, s.family), {
      occurredOn: '2026-10-06',
      description: 'Simit',
      lines: expenseLines({ categoryAccountId: fees, paymentAccountId: s.wife.bank, amountMinor: 33_600, currency: 'IDR' }),
    });
    const deleted = await atm(s.wife, s.family, s.lira, s.exchange);
    await voidTransaction(s.wife.database, inBook(s.wife.ws, s.family), deleted);
    await s.settle();
    const ids = [early, listedOne, withFee, snack, deleted, 'no-such-transaction', listedOne];
    const result = await addToTrip(s, ids);
    expectAccounted(ids, result);
    expect(result.listed).toEqual([{ transactionId: early }, { transactionId: listedOne }, { transactionId: withFee }]);
    expect(result.moved.map((m) => m.transactionId)).toEqual([snack]);
    expect(result.kept.map((k) => k.transactionId)).toEqual([deleted, 'no-such-transaction']);
  });
});
