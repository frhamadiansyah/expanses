import { refundLines } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

// Two whole linked databases in one test: seconds on a busy machine.
vi.setConfig({ testTimeout: 60_000 });
import {
  addFeeReversal,
  cardFeeYears,
  categoryIdsByKey,
  createAccount,
  createDatabase,
  feeLeftOutIds,
  FEE_CHARGE_DESCRIPTION,
  FEE_REVERSAL_DESCRIPTION,
  nativeBalances,
  netWorthAt,
  openingsOf,
  pairBeforeAppFees,
  postTransaction,
  replaceTransaction,
  saveCardTerms,
  undoFeeWaived,
  voidTransaction,
} from '../src/index';
import { createNodeExecutor } from '../src/node';
import { setupDb } from './helpers';
import { exchange, linkedPair, sameRows } from './self/devices';

/*
 * The fee charged before the app, as a row of its own (owner, 22 Nov 2026): beside a reversal of a fee charged before
 * the card's start day the app adds the fee on its own day, paid off before the app, so both cards look the same while
 * what the card owes, its balance on every day, net worth and the starting balance the owner typed never change.
 * Invented card and figures.
 */

const TODAY = '2026-11-13';
const FEE = 950_000;
const OWED = 4_000_000;
const START = '2026-11-01';

async function card() {
  const t = await setupDb();
  const acc = await createAccount(t.database, t.ws, { name: 'Sample card', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: OWED, openedOn: START });
  await saveCardTerms(t.database, t.ws, { accountId: acc.id, statementDay: 22, dueDay: 9, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: '2025-10-15' });
  const keys = await categoryIdsByKey(t.database, t.ws);
  /** The reversal as an older app recorded it: money back alone, kept against the year, with no fee row beside it. */
  const olderReversal = async (on = '2026-11-13', link = true) => {
    const id = await postTransaction(t.database, t.ws, {
      occurredOn: on,
      description: FEE_REVERSAL_DESCRIPTION,
      lines: refundLines({ categoryAccountId: keys['miscellaneous.membership_fee']!, paymentAccountId: acc.id, amountMinor: FEE, currency: 'IDR' }),
      excludedFromReport: true,
    });
    if (link) {
      await t.database.db.run(sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
                                  VALUES (${id}, ${t.ws.workspaceId}, ${acc.id}, 2026, 'null', ${new Date().toISOString()})`);
    }
    return id;
  };
  /** The card's balance and net worth on every day from a month before the fee to after today. */
  const everyDay = async () => {
    const out: string[] = [];
    for (let d = new Date('2026-09-15T00:00:00Z'); d <= new Date('2026-12-15T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
      const day = d.toISOString().slice(0, 10);
      const owed = (await nativeBalances(t.database, t.ws, day))[acc.id] ?? 0;
      const worth = (await netWorthAt(t.database, t.ws, day, {})).netWorthMinor;
      out.push(`${day} ${owed} ${worth}`);
    }
    return out;
  };
  const opening = async () => (await openingsOf(t.database, t.ws, [acc.id]))[acc.id];
  const years = () => cardFeeYears(t.database.db, t.ws, { cardId: acc.id, today: TODAY });
  const pairs = async () =>
    t.database.db.values<[string, string, string, string]>(sql`SELECT id, occurred_on, description, status FROM transactions WHERE external_ref LIKE 'fee-before-app:%' ORDER BY created_at`);
  const status = async (id: string) => (await t.database.db.values<[string]>(sql`SELECT status FROM transactions WHERE id = ${id}`))[0]?.[0];
  return { ...t, id: acc.id, keys, olderReversal, everyDay, opening, years, pairs, status };
}

describe('the fee row beside a fee reversed before the app', () => {
  it('is added with the reversal: on the fee’s day, Annual fee in Membership fee; the card owes what a lone reversal leaves', async () => {
    const withPair = await card();
    const lone = await card();
    await addFeeReversal(withPair.database, withPair.ws, { cardId: withPair.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    await lone.olderReversal('2026-11-13', false);

    const [pair] = await withPair.pairs();
    expect(pair).toEqual([expect.any(String), '2026-10-15', FEE_CHARGE_DESCRIPTION, 'posted']);
    // Every day, the card owes what it owes with the reversal alone, and net worth is the same.
    expect(await withPair.everyDay()).toEqual(await lone.everyDay());
    // The starting balance the owner typed, and the day the card is counted from, are as they were.
    expect(await withPair.opening()).toMatchObject({ occurredOn: START, amountMinor: -OWED });
    expect((await withPair.years())?.startsOn).toBe(START);
    expect((await withPair.years())?.current).toMatchObject({ lines: ['charged', 'reversal'], charge: { transactionId: pair![0], amountMinor: FEE } });
  });

  it('goes with its reversal when the reversal is deleted, and the card owes exactly what it did before both', async () => {
    const t = await card();
    const before = await t.everyDay();
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    const [pair] = await t.pairs();
    await voidTransaction(t.database, t.ws, back);
    expect(await t.status(pair![0])).toBe('void');
    expect(await t.everyDay()).toEqual(before);
    expect((await t.years())?.current).toMatchObject({ lines: ['pending'], beforeApp: true });
  });

  it('goes with its reversal on Reset too', async () => {
    const t = await card();
    const before = await t.everyDay();
    await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    const [pair] = await t.pairs();
    await undoFeeWaived(t.database, t.ws, { cardId: t.id, today: TODAY });
    expect(await t.status(pair![0])).toBe('void');
    expect(await t.everyDay()).toEqual(before);
  });

  it('stays while an edit of the reversal stands, and goes once the edit is deleted', async () => {
    const t = await card();
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    const [pair] = await t.pairs();
    const edited = await replaceTransaction(t.database, t.ws, back, {
      occurredOn: '2026-11-12',
      description: FEE_REVERSAL_DESCRIPTION,
      lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: t.id, amountMinor: FEE, currency: 'IDR' }),
    });
    expect(await t.status(pair![0])).toBe('posted');
    await voidTransaction(t.database, t.ws, edited);
    expect(await t.status(pair![0])).toBe('void');
  });

  it('deleted by hand, takes its settlement with it (the card owes the same) and is never made again', async () => {
    const t = await card();
    await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    const withIt = await t.everyDay();
    const [pair] = await t.pairs();
    await voidTransaction(t.database, t.ws, pair![0]);
    expect(await t.everyDay()).toEqual(withIt);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(0);
    expect((await t.pairs()).filter((row) => row[3] === 'posted')).toHaveLength(0);
    // The reversal reads as before the app again, and stays out of reports.
    expect((await t.years())?.current).toMatchObject({ lines: ['charged-before-app', 'reversal'], beforeApp: true });
  });
});

describe('the fee row follows its reversal', () => {
  const edit = (t: Awaited<ReturnType<typeof card>>, id: string, amountMinor: number) =>
    replaceTransaction(t.database, t.ws, id, {
      occurredOn: '2026-11-13',
      description: FEE_REVERSAL_DESCRIPTION,
      lines: refundLines({ categoryAccountId: t.keys['miscellaneous.membership_fee']!, paymentAccountId: t.id, amountMinor, currency: 'IDR' }),
    });
  const posted = async (t: Awaited<ReturnType<typeof card>>) =>
    t.database.db.values<[string, number]>(sql`
      SELECT t.id, -e.amount_minor FROM transactions t JOIN entries e ON e.transaction_id = t.id AND e.account_id = ${t.id}
      WHERE t.status = 'posted' AND t.external_ref LIKE 'fee-before-app:%'`);

  it('takes the reversal’s new amount when it is edited, there and back, and the card owes what a lone reversal leaves', async () => {
    const t = await card();
    const lone = await card();
    const back = await addFeeReversal(t.database, t.ws, { cardId: t.id, today: TODAY, amountMinor: FEE, on: '2026-11-13' });
    const loneBack = await lone.olderReversal('2026-11-13', false);
    const smaller = await edit(t, back, FEE - 50_000);
    await edit(lone, loneBack, FEE - 50_000);
    const [pair] = await posted(t);
    expect(await posted(t)).toHaveLength(1);
    expect(pair![1]).toBe(FEE - 50_000);
    expect(await t.everyDay()).toEqual(await lone.everyDay());
    expect([...(await feeLeftOutIds(t.database, t.ws))].sort()).toEqual([pair![0], smaller].sort());
    // …and back again: a new row each time, never a clash with the one it replaced.
    const again = await edit(t, smaller, FEE);
    expect((await posted(t)).map((row) => row[1])).toEqual([FEE]);
    expect([...(await feeLeftOutIds(t.database, t.ws))]).toContain(again);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(0);
  });

  it('pairs an edited reversal whose year still keeps the id it had before the edit (an older app’s edit)', async () => {
    const t = await card();
    const first = await t.olderReversal();
    const edited = await edit(t, first, FEE);
    // An older app did not move the year's link to the edit.
    await t.database.db.run(sql`UPDATE card_fee_refunds SET transaction_id = ${first} WHERE transaction_id = ${edited}`);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(1);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(0);
    expect(await posted(t)).toHaveLength(1);
  });

  it('pairs an edited reversal whose link moved with the edit', async () => {
    const t = await card();
    const first = await t.olderReversal();
    await edit(t, first, FEE);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(1);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(0);
  });
});

describe('existing data: a reversal already on the card with no fee row', () => {
  it('gets its fee row once, asking again makes none, and every day’s balance and net worth are the same', async () => {
    const t = await card();
    const back = await t.olderReversal();
    const before = await t.everyDay();
    const openingBefore = await t.opening();
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(1);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(0);
    const made = await t.pairs();
    expect(made).toHaveLength(1);
    expect(made[0]!.slice(1)).toEqual(['2026-10-15', FEE_CHARGE_DESCRIPTION, 'posted']);
    expect(await t.everyDay()).toEqual(before);
    expect(await t.opening()).toEqual(openingBefore);
    expect((await t.years())?.current).toMatchObject({ lines: ['charged', 'reversal'], reversal: { transactionId: back } });
  });

  it('makes none for a reversal not kept against its year here (a partner’s phone)', async () => {
    const t = await card();
    await t.olderReversal('2026-11-13', false);
    expect(await pairBeforeAppFees(t.database, t.ws, TODAY)).toBe(0);
    expect(await t.pairs()).toHaveLength(0);
  });

  it('makes the same rows on two linked devices, so their copies hold one', async () => {
    const a = await card();
    await a.olderReversal();
    // A linked device starts as a byte copy.
    const b = createDatabase(createNodeExecutor());
    await b.importBytes(await a.database.exportBytes());
    await pairBeforeAppFees(a.database, a.ws, TODAY);
    await pairBeforeAppFees(b, a.ws, TODAY);
    const rowsOf = async (db: typeof b) =>
      db.db.values(sql`
        SELECT t.id, t.external_ref, e.id, e.account_id, e.amount_minor FROM transactions t JOIN entries e ON e.transaction_id = t.id
        WHERE t.external_ref LIKE 'fee-before-app:%' OR t.external_ref LIKE 'before-app:%' ORDER BY t.id, e.id`);
    const made = await rowsOf(a.database);
    expect(made).toHaveLength(4);
    expect(await rowsOf(b)).toEqual(made);
  });

  it('made on two linked devices at once, their copies hold it once after they swap changes', async () => {
    let cardId = '';
    const { phone, mac } = await linkedPair(async (t) => {
      const acc = await createAccount(t.database, t.ws, { name: 'Sample card', kind: 'liability', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: OWED, openedOn: START });
      cardId = acc.id;
      await saveCardTerms(t.database, t.ws, { accountId: acc.id, statementDay: 22, dueDay: 9, creditLimitMinor: null, annualFeeMinor: FEE, annualFeeOn: '2025-10-15' });
      const keys = await categoryIdsByKey(t.database, t.ws);
      const id = await postTransaction(t.database, t.ws, {
        occurredOn: '2026-11-13',
        description: FEE_REVERSAL_DESCRIPTION,
        lines: refundLines({ categoryAccountId: keys['miscellaneous.membership_fee']!, paymentAccountId: acc.id, amountMinor: FEE, currency: 'IDR' }),
        excludedFromReport: true,
      });
      await t.database.db.run(sql`INSERT INTO card_fee_refunds (transaction_id, workspace_id, account_id, fee_year, challenge_json, created_at)
                                  VALUES (${id}, ${t.ws.workspaceId}, ${acc.id}, 2026, 'null', ${new Date().toISOString()})`);
    });
    expect(await pairBeforeAppFees(phone.database, phone.ws, TODAY)).toBe(1);
    expect(await pairBeforeAppFees(mac.database, mac.ws, TODAY)).toBe(1);
    await exchange(phone, mac);
    for (const device of [phone, mac]) {
      const rows = await device.database.db.values(sql`SELECT id FROM transactions WHERE status = 'posted' AND (external_ref LIKE 'fee-before-app:%' OR external_ref LIKE 'before-app:%')`);
      expect(rows).toHaveLength(2);
      const entries = await device.database.db.values(sql`SELECT COUNT(*) FROM entries e JOIN transactions t ON t.id = e.transaction_id WHERE t.external_ref LIKE 'fee-before-app:%'`);
      expect(entries).toEqual([[2]]);
      expect((await nativeBalances(device.database, device.ws))[cardId]).toBe(-OWED + FEE);
    }
    expect(await sameRows(phone, mac)).toEqual([]);
  });
});
