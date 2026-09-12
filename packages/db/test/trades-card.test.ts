import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  cardSpendLines,
  categoryIdsByKey,
  categoryTotalsBetween,
  checkLedgerIntegrity,
  createAccount,
  type Database,
  listTransactions,
  nativeBalances,
  recordTrade,
  saveAssetProfile,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

const CYCLE = { from: '2026-09-01', to: '2026-09-30' };

let database: Database;
let ws: WorkspaceContext;
let bca: AccountRow;
let card: AccountRow;
let gold: AccountRow;
let categories: Record<string, string>;

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bca = await createAccount(database, ws, { name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 50_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'BCA KrisFlyer Visa Infinite', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  gold = await createAccount(database, ws, { name: 'UBS gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
  categories = await categoryIdsByKey(database, ws);
});

const buyOnCard = (extra: Record<string, unknown> = {}) =>
  recordTrade(database, ws, {
    accountId: gold.id,
    kind: 'buy',
    occurredOn: '2026-09-12',
    unitsMicro: 2_000_000,
    grossMinor: 3_980_000,
    feeMinor: 0,
    taxMinor: 0,
    cashAccountId: card.id,
    spendCategoryId: categories['shopping']!,
    mcc: '5944',
    ...extra,
  });

describe('buying a holding with a credit card', () => {
  it('raises the holding and the card together, and spends nothing', async () => {
    await buyOnCard();

    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(3_980_000);
    // A liability is credited, so the balance goes the other way; the card owes Rp 3.980.000.
    expect(balances[card.id]).toBe(-3_980_000);
    expect(balances[bca.id]).toBe(50_000_000);
    await expect(categoryTotalsBetween(database, ws, 'expense', CYCLE.from, CYCLE.to)).resolves.toEqual([]);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('keeps the purchase category and the MCC on the card line', async () => {
    await buyOnCard();

    const [transaction] = await listTransactions(database, ws, {});
    expect(transaction!.mcc).toBe('5944');
    const cardEntry = transaction!.entries.find((entry) => entry.accountId === card.id)!;
    expect(cardEntry.spendCategoryId).toBe(categories['shopping']);
  });

  it('is picked up as card spend, so points can be worked out', async () => {
    await buyOnCard();

    const lines = await cardSpendLines(database, ws, card.id, CYCLE.from, CYCLE.to);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ amountMinor: 3_980_000, categoryId: categories['shopping'], mcc: '5944' });
  });

  it('still records the purchase when no category is given, and earns nothing', async () => {
    await buyOnCard({ spendCategoryId: null, mcc: null });

    const balances = await nativeBalances(database, ws);
    expect(balances[gold.id]).toBe(3_980_000);
    await expect(cardSpendLines(database, ws, card.id, CYCLE.from, CYCLE.to)).resolves.toEqual([]);
  });

  it('leaves a purchase paid from the bank out of card spend', async () => {
    await recordTrade(database, ws, {
      accountId: gold.id,
      kind: 'buy',
      occurredOn: '2026-09-12',
      unitsMicro: 2_000_000,
      grossMinor: 3_980_000,
      feeMinor: 0,
      taxMinor: 0,
      cashAccountId: bca.id,
    });

    await expect(cardSpendLines(database, ws, card.id, CYCLE.from, CYCLE.to)).resolves.toEqual([]);
  });

  it('refuses to pay the proceeds of a sale onto a card', async () => {
    await buyOnCard();

    await expect(
      recordTrade(database, ws, {
        accountId: gold.id,
        kind: 'sell',
        occurredOn: '2026-09-20',
        unitsMicro: 1_000_000,
        grossMinor: 1_900_000,
        feeMinor: 0,
        taxMinor: 0,
        cashAccountId: card.id,
      }),
    ).rejects.toThrow(/bank or cash/i);
  });
});
