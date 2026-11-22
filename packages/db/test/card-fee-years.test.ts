import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { refundLines } from '@expanses/core';
import {
  addFeeCharge,
  addFeeReversal,
  cardFeeYears,
  categoryIdsByKey,
  challengeFeeYear,
  createAccount,
  createDatabase,
  type Database,
  createWorkspace,
  extrasFor,
  FEE_CHARGE_DESCRIPTION,
  feeWaivedStatus,
  FEE_REVERSAL_DESCRIPTION,
  getCardTerms,
  getFeeWaiver,
  listFeeRefunds,
  migrate,
  MIGRATIONS,
  nativeBalances,
  postTransaction,
  saveCardTerms,
  saveFeeWaived,
  saveFeeWaiver,
  undoFeeWaived,
  voidTransaction,
  waivedFeeYears,
} from '../src/index';
import { createNodeExecutor, type NodeExecutor } from '../src/node';
import { setupDb } from './helpers';

/*
 * The Fee waiver page's fee years (owner, 13 Nov 2026): each line comes from the card's own transactions, and the two
 * writes (Add the charge, Add reversal) go through the ledger on this card in Membership fee. Invented figures.
 */

const TODAY = '2026-11-13';
const FEE = 1_150_000;

async function card(opening?: { minor: number; on: string }) {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, {
    name: 'Fee card',
    kind: 'liability',
    subtype: 'credit_card',
    currency: 'IDR',
    ...(opening ? { openingBalanceMinor: opening.minor, openedOn: opening.on } : {}),
  });
  await saveCardTerms(t.database, t.ws, { accountId: acc.id, statementDay: 22, dueDay: 9, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: '2025-10-15' });
  const keys = await categoryIdsByKey(t.database, t.ws);
  const balance = async () => (await nativeBalances(t.database, t.ws))[acc.id] ?? 0;
  const years = (today = TODAY) => cardFeeYears(t.database.db, t.ws, { cardId: acc.id, today });
  const post = (description: string, key: string, amountMinor: number, occurredOn: string) =>
    postTransaction(t.database, t.ws, {
      occurredOn,
      description,
      lines: [
        { accountId: keys[key]!, amountMinor, currency: 'IDR' },
        { accountId: acc.id, amountMinor: -amountMinor, currency: 'IDR' },
      ],
    });
  const refund = (description: string, key: string, amountMinor: number, occurredOn: string) =>
    postTransaction(t.database, t.ws, { occurredOn, description, lines: refundLines({ categoryAccountId: keys[key]!, paymentAccountId: acc.id, amountMinor, currency: 'IDR' }) });
  const row = async (id: string) =>
    (await t.database.db.values<[string, string, string]>(sql`SELECT occurred_on, description, status FROM transactions WHERE id = ${id}`))[0];
  const categoryOf = async (id: string) =>
    (await t.database.db.values<[string]>(sql`SELECT account_id FROM entries WHERE transaction_id = ${id} AND account_id != ${acc.id}`)).map((r) => r[0]);
  return { ...t, id: acc.id, keys, balance, years, post, refund, row, categoryOf };
}

describe('the fee year from the card’s transactions', () => {
  it('reads Pending with nothing recorded, for the covered charge, with no earlier years', async () => {
    const t = await card();
    const years = await t.years();
    expect(years?.current).toMatchObject({ year: 2026, covered: '2026-10-15', lines: ['pending'], state: 'pending', charge: null, reversal: null, marked: false, beforeApp: false });
    expect(years?.earlier).toEqual([]);
    expect(years?.feeMinor).toBe(FEE);
  });

  it('is null on a card with no fee date', async () => {
    const t = await card();
    await saveCardTerms(t.database, t.ws, { accountId: t.id, statementDay: 22, dueDay: 9, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: null });
    expect(await t.years()).toBeNull();
  });

  it('reads Charged from a fee charge already on the card', async () => {
    const t = await card();
    const id = await t.post('IURAN TAHUNAN', 'miscellaneous.fees_charges', FEE, '2026-10-16');
    expect((await t.years())?.current).toMatchObject({ lines: ['charged'], state: 'charged', charge: { transactionId: id, on: '2026-10-16', amountMinor: FEE } });
  });

  it('reads a refund in Membership fee for the fee, found later (a statement check), as the reversal', async () => {
    const t = await card();
    await t.post('Annual fee', 'miscellaneous.membership_fee', FEE, '2026-10-15');
    const back = await t.refund('Refund', 'miscellaneous.membership_fee', FEE, '2026-11-02');
    expect((await t.years())?.current).toMatchObject({ lines: ['charged', 'reversal'], state: 'waived', reversal: { transactionId: back, on: '2026-11-02', amountMinor: FEE, ours: false } });
  });

  it('reads Waived for a year marked waived with nothing charged, and Pending again once reset', async () => {
    const t = await card();
    await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    expect((await t.years())?.current).toMatchObject({ lines: ['waived'], state: 'waived', marked: true });
    await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    expect((await t.years())?.current).toMatchObject({ lines: ['pending'], state: 'pending', marked: false });
  });
});

describe('Add the charge', () => {
  it('posts the fee on the card in Membership fee, named Annual fee, and the year reads Charged', async () => {
    const t = await card();
    const id = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    expect(await t.row(id)).toEqual(['2026-10-15', FEE_CHARGE_DESCRIPTION, 'posted']);
    expect(FEE_CHARGE_DESCRIPTION).toBe('Annual fee');
    expect(await t.categoryOf(id)).toEqual([t.keys['miscellaneous.membership_fee']]);
    expect(await t.balance()).toBe(-FEE);
    expect((await t.years())?.current).toMatchObject({ lines: ['charged'], state: 'charged', charge: { transactionId: id, amountMinor: FEE } });
    // It counts as that month's spending: nothing about it is left out of reports.
    expect((await extrasFor(t.database.db, t.ws, [id])).get(id)?.excluded ?? false).toBe(false);
  });

  it('refuses a second charge, nothing at all, a day after today, and a day far from the fee date', async () => {
    const t = await card();
    const add = (amountMinor: number, on: string) => addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor, on });
    await expect(add(0, '2026-10-15')).rejects.toThrow();
    await expect(add(FEE, '2026-11-14')).rejects.toThrow();
    await expect(add(FEE, '2026-06-01')).rejects.toThrow();
    await add(FEE, '2026-10-15');
    await expect(add(FEE, '2026-10-16')).rejects.toThrow();
    expect(await t.balance()).toBe(-FEE);
  });

  it('refuses a year marked waived, and a charge dated before the card is counted from', async () => {
    const t = await card({ minor: 3_000_000, on: '2026-11-01' });
    await expect(addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' })).rejects.toThrow();
    const u = await card();
    await saveFeeWaived(u.database, u.ws, { cardId: u.id, today: TODAY });
    await expect(addFeeCharge(u.database, u.ws, { cardId: u.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' })).rejects.toThrow();
    expect(await u.balance()).toBe(0);
  });
});

describe('Add reversal', () => {
  it('cancels a charge in the app in its own category, kept against the year, and the year reads waived', async () => {
    const t = await card();
    const charge = await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    const id = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    expect(await t.row(id)).toEqual(['2026-11-03', FEE_REVERSAL_DESCRIPTION, 'posted']);
    expect(FEE_REVERSAL_DESCRIPTION).toBe('Annual fee reversal');
    expect(await t.categoryOf(id)).toEqual(await t.categoryOf(charge));
    expect(await t.balance()).toBe(0);
    expect((await extrasFor(t.database.db, t.ws, [id])).get(id)?.excluded ?? false).toBe(false);
    expect(await listFeeRefunds(t.database.db, t.ws, t.id)).toEqual([{ transactionId: id, accountId: t.id, feeYear: 2026 }]);
    expect((await t.years())?.current).toMatchObject({ lines: ['charged', 'reversal'], state: 'waived', reversal: { transactionId: id, on: '2026-11-03', amountMinor: FEE, ours: true } });
  });

  it('cancels a charge of another category by its own category', async () => {
    const t = await card();
    const charge = await t.post('BIAYA TAHUNAN', 'miscellaneous.fees_charges', FEE, '2026-10-17');
    const id = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    expect(await t.categoryOf(id)).toEqual(await t.categoryOf(charge));
  });

  it('refuses a second reversal, one before the charge, one after today, nothing, and one with no charge to reverse', async () => {
    const t = await card();
    const add = (amountMinor: number, on: string) => addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor, on });
    // Nothing charged, and no starting day the fee is before: there is no charge to reverse.
    await expect(add(FEE, '2026-11-03')).rejects.toThrow();
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    await expect(add(FEE, '2026-10-14')).rejects.toThrow();
    await expect(add(FEE, '2026-11-14')).rejects.toThrow();
    await expect(add(0, '2026-11-03')).rejects.toThrow();
    await add(FEE, '2026-11-03');
    await expect(add(FEE, '2026-11-04')).rejects.toThrow();
    expect(await t.balance()).toBe(0);
  });

  it('refuses a reversal when one is already on the card from a statement check', async () => {
    const t = await card();
    await t.post('Annual fee', 'miscellaneous.membership_fee', FEE, '2026-10-15');
    await t.refund('Refund', 'miscellaneous.membership_fee', FEE, '2026-11-02');
    await expect(addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' })).rejects.toThrow();
  });

  /*
   * The owner's case: the card is counted from 1 Nov, after the 15 Oct fee, so that charge is in the starting balance
   * and has no row. The reversal raises the card's balance but is left out of reports: October's charge was never
   * counted, so November's spending must not drop. Beside it the fee gets its row on its own day (owner, 22 Nov 2026),
   * paid off before the app, so the card owes only what the reversal took off.
   */
  it('records money back for a charge before the app, left out of reports, with the fee as its own row paid off before the app', async () => {
    const t = await card({ minor: 4_000_000, on: '2026-11-01' });
    expect((await t.years())?.current).toMatchObject({ lines: ['pending'], beforeApp: true });
    const owed = await t.balance();
    const id = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    expect(await t.row(id)).toEqual(['2026-11-13', FEE_REVERSAL_DESCRIPTION, 'posted']);
    expect(await t.categoryOf(id)).toEqual([t.keys['miscellaneous.membership_fee']]);
    expect(await t.balance()).toBe(owed + FEE);
    expect((await extrasFor(t.database.db, t.ws, [id])).get(id)?.excluded).toBe(true);
    const current = (await t.years())?.current;
    expect(current).toMatchObject({ lines: ['charged', 'reversal'], state: 'waived', beforeApp: false, charge: { on: '2026-10-15', amountMinor: FEE }, reversal: { transactionId: id, ours: true } });
    const fee = current!.charge!.transactionId;
    expect(await t.row(fee)).toEqual(['2026-10-15', FEE_CHARGE_DESCRIPTION, 'posted']);
    expect(await t.categoryOf(fee)).toEqual([t.keys['miscellaneous.membership_fee']]);
    expect((await extrasFor(t.database.db, t.ws, [fee])).get(fee)?.excluded).toBe(true);
  });

  it('lets the reversal go again by deleting it: the line goes away', async () => {
    const t = await card();
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    const id = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    await voidTransaction(t.database, t.ws, id);
    expect((await t.years())?.current).toMatchObject({ lines: ['charged'], state: 'charged', reversal: null });
  });
});

describe('earlier years', () => {
  it('lists each past fee year newest first from its own rows, and leaves out years with nothing recorded', async () => {
    const t = await card({ minor: 500_000, on: '2023-01-05' });
    await t.post('Annual fee', 'miscellaneous.membership_fee', 950_000, '2024-10-15');
    await t.post('Annual fee', 'miscellaneous.membership_fee', FEE, '2025-10-16');
    const back = await t.refund('Annual fee refund', 'miscellaneous.membership_fee', FEE, '2025-11-02');
    const earlier = (await t.years())?.earlier ?? [];
    expect(earlier.map((y) => [y.year, y.state, y.charge?.amountMinor ?? null, y.reversal?.transactionId ?? null])).toEqual([
      [2025, 'waived', FEE, back],
      [2024, 'charged', 950_000, null],
    ]);
    // This year's charge is not one of them.
    expect((await t.years())?.current.lines).toEqual(['pending']);
  });

  it('lists a past year marked waived, and Reset for that year clears only its mark', async () => {
    const t = await card({ minor: 500_000, on: '2024-01-05' });
    await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: '2025-11-13' });
    expect((await t.years())?.earlier.map((y) => [y.year, y.lines])).toEqual([[2025, ['waived']]]);
    await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, year: 2025 });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBeNull();
    expect((await t.years())?.earlier).toEqual([]);
  });

  it('never resets another year than the one asked for', async () => {
    const t = await card({ minor: 500_000, on: '2024-01-05' });
    await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY, year: 2025 });
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
  });
});

describe('Free for life', () => {
  it('saves a waiver with nothing to spend and no days, and it is no challenge', async () => {
    const t = await card();
    await saveFeeWaiver(t.database, t.ws, t.id, { kind: 'lifetime', amountMinor: 0, countedFrom: '2026-01-01', spendBy: '2026-02-01', categoryIds: ['x'] });
    expect(await getFeeWaiver(t.database.db, t.ws, t.id)).toEqual({ kind: 'lifetime', amountMinor: 0, countedFrom: null, spendBy: null, categoryIds: [] });
    expect(await challengeFeeYear(t.database.db, t.ws, t.id)).toBeNull();
  });
  it('still refuses a yearly amount or a challenge with nothing to spend', async () => {
    const t = await card();
    await expect(saveFeeWaiver(t.database, t.ws, t.id, { kind: 'automatic', amountMinor: 0, countedFrom: null, spendBy: null, categoryIds: [] })).rejects.toThrow();
  });
});

describe('migration 0115 (fee waiver lifetime)', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => {
    executor?.close();
    executor = undefined;
  });
  async function before0115(): Promise<Database> {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version < 115));
    return database;
  }

  it('is version 115 and named fee_waiver_lifetime', () => {
    expect(MIGRATIONS.find((m) => m.version === 115)).toMatchObject({ name: 'fee_waiver_lifetime' });
  });

  it('keeps every waiver as it was, fee year included, and lets a lifetime one in with no amount', async () => {
    const database = await before0115();
    await database.db.run(sql`
      INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, counted_from, spend_by, category_ids, created_at, fee_year)
      VALUES ('card-1', 'ws-1', 'challenge', 12000000, '2026-10-21', '2027-01-19', '["c"]', '2026-10-21T00:00:00Z', 2026),
             ('card-2', 'ws-1', 'automatic', 50000000, NULL, NULL, '[]', '2026-01-02T00:00:00Z', NULL)`);
    await expect(database.db.run(sql`INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, category_ids, created_at) VALUES ('card-3', 'ws-1', 'lifetime', NULL, '[]', 'x')`)).rejects.toThrow();
    await migrate(database);
    expect(await database.db.values(sql`SELECT account_id, workspace_id, kind, amount_minor, counted_from, spend_by, category_ids, created_at, fee_year FROM card_fee_waivers ORDER BY account_id`)).toEqual([
      ['card-1', 'ws-1', 'challenge', 12000000, '2026-10-21', '2027-01-19', '["c"]', '2026-10-21T00:00:00Z', 2026],
      ['card-2', 'ws-1', 'automatic', 50000000, null, null, '[]', '2026-01-02T00:00:00Z', null],
    ]);
    await database.db.run(sql`INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, category_ids, created_at) VALUES ('card-3', 'ws-1', 'lifetime', NULL, '[]', 'x')`);
    await expect(database.db.run(sql`INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, category_ids, created_at) VALUES ('card-4', 'ws-1', 'automatic', 0, '[]', 'x')`)).rejects.toThrow();
    await expect(database.db.run(sql`INSERT INTO card_fee_waivers (account_id, workspace_id, kind, amount_minor, category_ids, created_at) VALUES ('card-5', 'ws-1', 'other', 5, '[]', 'x')`)).rejects.toThrow();
  });
});

/* Fix round 1 (review, 13 Nov 2026). */
describe('one waived mark per year', () => {
  it('keeps 2024 and 2026 both Waived · not charged, and the latest year on the card terms for older readers', async () => {
    const t = await card({ minor: 500_000, on: '2023-01-05' });
    await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: '2024-11-13' });
    await saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    const years = await t.years();
    expect(years?.current).toMatchObject({ year: 2026, lines: ['waived'] });
    expect(years?.earlier.map((y) => [y.year, y.lines])).toEqual([[2024, ['waived']]]);
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2026);
    // Reset 2026: its own mark goes; 2024 stays, and becomes the latest.
    await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    expect((await t.years())?.current.lines).toEqual(['pending']);
    expect((await t.years())?.earlier.map((y) => y.year)).toEqual([2024]);
    expect((await getCardTerms(t.database, t.ws, t.id))?.annualFeeWaivedYear).toBe(2024);
  });

  it('refuses Waived, not charged once the charge is on the card', async () => {
    const t = await card();
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    await expect(saveFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY })).rejects.toThrow();
    expect((await t.years())?.current.marked).toBe(false);
  });
});

describe('the reversal seen from the other phone', () => {
  // Phone A charged the fee with its tax and reversed the fee alone; phone B gets both transactions, never the link.
  const TAXED = 1_265_000;
  it('reads phone A’s reversal for a fee-and-tax charge as the reversal, and offers no second one', async () => {
    const t = await card();
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: TAXED, on: '2026-10-15' });
    const id = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-03' });
    await t.database.db.run(sql`DELETE FROM card_fee_refunds`);
    expect((await t.years())?.current).toMatchObject({ lines: ['charged', 'reversal'], state: 'waived', reversal: { transactionId: id, amountMinor: FEE, ours: false } });
    await expect(addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-04' })).rejects.toThrow();
    expect(await t.balance()).toBe(-(TAXED - FEE));
  });

  // Review round 2 (N2): a late fee nearer the date must not take the reversal from the annual fee.
  it('gives the reversal to the annual fee, not to a late fee nearer the fee date', async () => {
    const t = await card();
    await t.post('Biaya keterlambatan', 'miscellaneous.fees_charges', 150_000, '2026-10-20');
    const fee = await t.post('Annual fee', 'miscellaneous.membership_fee', FEE, '2026-11-01');
    const id = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-05' });
    await t.database.db.run(sql`DELETE FROM card_fee_refunds`);
    expect((await t.years())?.current).toMatchObject({ charge: { transactionId: fee }, lines: ['charged', 'reversal'], reversal: { transactionId: id, ours: false } });
    await expect(addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-06' })).rejects.toThrow();
  });

  it('reads it with no charge behind it (before the app) whatever its amount', async () => {
    const t = await card({ minor: 4_000_000, on: '2026-11-01' });
    // As an older phone posted it: the reversal alone, with no fee row beside it and no link here.
    const id = await t.refund(FEE_REVERSAL_DESCRIPTION, 'miscellaneous.membership_fee', 1_000_000, '2026-11-13');
    expect((await t.years())?.current).toMatchObject({ lines: ['charged-before-app', 'reversal'], reversal: { transactionId: id, ours: false } });
  });

  it('refuses a reversal above the charge', async () => {
    const t = await card();
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    await expect(addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE + 1, on: '2026-11-03' })).rejects.toThrow();
    expect(await t.balance()).toBe(-FEE);
  });
});

describe('dates in what is refused', () => {
  it('names days as the app does, never as stored', async () => {
    const t = await card();
    await expect(addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-06-01' })).rejects.toThrow('Pick a day from 25 Sep to 29 Nov');
    await addFeeCharge(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-15' });
    await expect(addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-10-14' })).rejects.toThrow('The reversal cannot be before the charge, on 15 Oct');
  });
});

describe('one fee-year state everywhere', () => {
  it('reads a reversal a statement check found as waived for the challenge’s ✓ and for Recurring', async () => {
    const t = await card();
    await t.post('Annual fee', 'miscellaneous.membership_fee', FEE, '2026-10-15');
    const back = await t.refund('Refund', 'miscellaneous.membership_fee', FEE, '2026-11-02');
    expect(await feeWaivedStatus(t.database.db, t.ws, { cardId: t.id, today: TODAY })).toMatchObject({ waived: true, back: { transactionId: back, amountMinor: FEE, on: '2026-11-02' } });
    expect(await waivedFeeYears(t.database.db, t.ws, TODAY)).toEqual(new Map([[t.id, 2026]]));
  });
  it('leaves a pending or charged year out of the waived ones', async () => {
    const t = await card();
    expect(await waivedFeeYears(t.database.db, t.ws, TODAY)).toEqual(new Map());
    await t.post('Annual fee', 'miscellaneous.membership_fee', FEE, '2026-10-15');
    expect(await waivedFeeYears(t.database.db, t.ws, TODAY)).toEqual(new Map());
  });
});

describe('migration 0115 (waived years)', () => {
  let executor: NodeExecutor | undefined;
  afterEach(() => {
    executor?.close();
    executor = undefined;
  });
  it('copies each card’s waived year into its own row', async () => {
    executor = createNodeExecutor();
    const database = createDatabase(executor);
    await migrate(database, MIGRATIONS.filter((m) => m.version < 115));
    const ws = await createWorkspace(database, { name: 'Personal', type: 'personal', baseCurrency: 'IDR' });
    const acc = await createAccount(database, ws, { name: 'Old card', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
    await saveCardTerms(database, ws, { accountId: acc.id, statementDay: 22, dueDay: 9, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: '2025-10-15' });
    await database.db.run(sql`UPDATE card_terms SET annual_fee_waived_year = 2025 WHERE account_id = ${acc.id}`);
    await migrate(database);
    expect(await database.db.values(sql`SELECT account_id, workspace_id, fee_year FROM card_fee_waived_years`)).toEqual([[acc.id, ws.workspaceId, 2025]]);
  });
});
