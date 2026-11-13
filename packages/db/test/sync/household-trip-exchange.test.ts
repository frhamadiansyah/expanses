import { exchangeLines, exchangeWithFeeLines, expenseLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  createAccount,
  inBook,
  listSharedTransfers,
  listTransactions,
  moveIntoSharedEvent,
  nativeBalances,
  ownerScope,
  personalBook,
  postTransaction,
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

  it('recorded before Family was shared (filed as a purchase, no redacted row), it stays and says why', async () => {
    let id = '';
    const s = await familyAndTrip(async (wife, lira, exchange, family) => {
      id = await atm(wife, family, lira, exchange);
    });
    // The receipt's "Paid by" comes from here: it travels as a purchase, labelled with every non-category account.
    expect(await s.wife.database.db.values(sql`SELECT paid_label FROM sync_lineage WHERE head_transaction_id = ${id}`)).toEqual([['Wife Wallet + Currency Exchange + Wife Lira']]);
    expect(await s.wife.database.db.values(sql`SELECT 1 FROM shared_transfers WHERE transaction_id = ${id}`)).toEqual([]);
    const result = await addToTrip(s, [id]);
    expectAccounted([id], result);
    expect(result.kept).toEqual([{ transactionId: id, why: 'Recorded before Personal sent its transfers to the household, so the other phones never had it: it stays in Personal' }]);
    expect(await familyRows(s, s.wife)).toEqual(['Bank Contoh ATM']);
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
    expect(result.listed).toEqual([{ transactionId: listedOne }]);
    expect(result.moved.map((m) => m.transactionId)).toEqual([snack]);
    expect(result.kept.map((k) => k.transactionId)).toEqual([early, withFee, deleted, 'no-such-transaction']);
  });
});
