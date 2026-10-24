import type { CaptureLine, StatementPeriod } from '@expanses/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type CheckDecisions,
  type CheckDraftRow,
  createAccount,
  createCardAccount,
  fillSameMerchant,
  listAccounts,
  listTransactions,
  nativeBalances,
  prepareStatementCheck,
  recordStatementCheck,
  saveCardTerms,
} from '../src/index';
import { setupDb, type TestDb } from './helpers';

/*
 * A missing card row filed under Top-ups and said to be a top-up of a wallet: recorded as the one transaction the Top up
 * door records — the wallet takes what landed, the card owes the whole row, the fee is spending — so it still matches
 * the statement's figure. Invented rows and figures only.
 */

let current: TestDb | undefined;
afterEach(() => {
  current?.executor.close();
  current = undefined;
});

const line = (text: string, x: number, y: number, w = 0.2, h = 0.02): CaptureLine => ({ text, box: [x, y, w, h], height: h });
type Printed = [on: string, description: string, amount: string];
const image = (rows: Printed[], summary: { previous?: string; closing?: string } = {}): CaptureLine[] => {
  const out = rows.flatMap(([on, description, amount], i) => [line(on, 0.05, 0.1 + i * 0.05, 0.1), line(description, 0.25, 0.1 + i * 0.05, 0.5), line(amount, 0.85, 0.1 + i * 0.05, 0.12)]);
  let y = 0.1 + rows.length * 0.05 + 0.1;
  if (summary.previous) {
    out.push(line('Previous Balance', 0.05, y, 0.3), line(summary.previous, 0.85, y, 0.12));
    y += 0.05;
  }
  if (summary.closing) out.push(line('New Balance', 0.05, y, 0.3), line(summary.closing, 0.85, y, 0.12));
  return out;
};

const PERIOD: StatementPeriod = { start: '2026-08-11', end: '2026-09-10' };
const NO_DECISIONS: CheckDecisions = { differs: {}, flagged: {}, ask: {}, moveStart: false };

async function setup() {
  current = await setupDb();
  const { database, ws } = current;
  const card = await createCardAccount(database, ws, { name: 'Visa', subtype: 'credit_card', currency: 'IDR', openingBalanceMinor: 0, openedOn: '2026-01-01' });
  await saveCardTerms(database, ws, { accountId: card.id, statementDay: 10, dueDay: 25, creditLimitMinor: null, annualFeeMinor: null });
  const wallet = await createAccount(database, ws, { name: 'Pocket wallet', kind: 'asset', subtype: 'ewallet', currency: 'IDR' });
  const bank = await createAccount(database, ws, { name: 'Bank', kind: 'asset', subtype: 'bank', currency: 'IDR' });
  const all = await listAccounts(database, ws);
  const cat = (key: string) => all.find((a) => a.systemKey === key)!.id;
  const prepared = await prepareStatementCheck(database, ws, {
    cardAccountId: card.id,
    period: PERIOD,
    images: [image([['14AUG', 'WALLET RELOAD 7731', '1,010,000'], ['19AUG', 'WALLET RELOAD 7731', '255,000']], { previous: '0', closing: '1,265,000' })],
    today: '2026-09-20',
  });
  return { database, ws, card, wallet, bank, prepared, topUps: cat('miscellaneous.top_ups'), fees: cat('miscellaneous.fees_charges'), groceries: cat('household.groceries') };
}

/** Both rows under Top-ups: the first a top-up with a fee, the second one with none. */
function asTopUps(rows: CheckDraftRow[], topUps: string, wallet: string): CheckDraftRow[] {
  return rows.map((r, i) => ({ ...r, categoryId: topUps, categorySource: 'owner' as const, topUp: { walletAccountId: wallet, feeMinor: i === 0 ? 10_000 : 0 } }));
}

describe('a statement row recorded as a top-up', () => {
  it('lands what the charge less the fee came to, the card owing the whole row, and still reconciles', async () => {
    const h = await setup();
    expect(h.prepared.rows.map((r) => r.outcome)).toMatchObject([{ status: 'missing', as: 'purchase' }, { status: 'missing', as: 'purchase' }]);
    const result = await recordStatementCheck(h.database, h.ws, { ...h.prepared, rows: asTopUps(h.prepared.rows, h.topUps, h.wallet.id) }, NO_DECISIONS);
    expect(result).toMatchObject({ status: 'reconciled', differenceMinor: 0 });

    const balances = await nativeBalances(h.database, h.ws);
    expect(balances[h.wallet.id]).toBe(1_000_000 + 255_000);
    expect(balances[h.card.id]).toBe(-1_265_000);
    expect(balances[h.fees]).toBe(10_000);
    // Nothing is spent under Top-ups: it only names the card's line.
    expect(balances[h.topUps] ?? 0).toBe(0);

    const recorded = await listTransactions(h.database, h.ws, { accountId: h.card.id });
    expect(recorded).toHaveLength(2);
    const withFee = recorded.find((t) => t.occurredOn === '2026-08-14')!;
    expect(withFee.entries.map((e) => [e.accountId, e.amountMinor, e.spendCategoryId]).sort()).toEqual(
      [
        [h.wallet.id, 1_000_000, null],
        [h.card.id, -1_010_000, h.topUps],
        [h.fees, 10_000, null],
      ].sort(),
    );
  });

  it('spreads only the category to the same merchant, never the wallet and fee; another category drops them', () => {
    return setup().then((h) => {
      const picked = fillSameMerchant(h.prepared.rows, h.prepared.rows[0]!.index, h.topUps);
      const withTopUp = picked.map((r, i) => (i === 0 ? { ...r, topUp: { walletAccountId: h.wallet.id, feeMinor: 10_000 } } : r));
      expect(withTopUp[1]).toMatchObject({ categoryId: h.topUps, categorySource: 'same-merchant' });
      expect(withTopUp[1]!.topUp ?? null).toBeNull();
      // The same category again keeps the row's top-up; another one turns it back into a purchase.
      expect(fillSameMerchant(withTopUp, withTopUp[0]!.index, h.topUps)[0]!.topUp).toEqual({ walletAccountId: h.wallet.id, feeMinor: 10_000 });
      expect(fillSameMerchant(withTopUp, withTopUp[0]!.index, h.groceries)[0]).toMatchObject({ categoryId: h.groceries, topUp: null });
    });
  });

  it('refuses a wallet that is not a digital wallet, a fee as large as the row, and a top-up under another category', async () => {
    const h = await setup();
    const rows = asTopUps(h.prepared.rows, h.topUps, h.wallet.id);
    const bad = (patch: Partial<CheckDraftRow>) => recordStatementCheck(h.database, h.ws, { ...h.prepared, rows: rows.map((r, i) => (i === 0 ? { ...r, ...patch } : r)) }, NO_DECISIONS);
    await expect(bad({ topUp: { walletAccountId: h.bank.id, feeMinor: 0 } })).rejects.toMatchObject({ code: 'TOP_UP' });
    await expect(bad({ topUp: { walletAccountId: h.wallet.id, feeMinor: 1_010_000 } })).rejects.toMatchObject({ code: 'TOP_UP' });
    await expect(bad({ categoryId: h.groceries })).rejects.toMatchObject({ code: 'TOP_UP' });
    // Nothing was written by the refused attempts.
    expect(await listTransactions(h.database, h.ws, { accountId: h.card.id })).toHaveLength(0);
  });
});
