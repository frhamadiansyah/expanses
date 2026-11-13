import { beforeEach, describe, expect, it } from 'vitest';
import {
  acquiredDates, type AccountRow, assetValuesAt, checkLedgerIntegrity, createAccount, type Database, getAssetProfile, listAccounts, listTrades, listValuations, nativeBalances, openAsset,
  postedTradeMoney, recordTrade, saveAssetProfile, type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

/* Invented figures throughout: a made-up bank, card and bond. */
let database: Database;
let ws: WorkspaceContext;
let bank: AccountRow;
let card: AccountRow;
let category: string;

const BOND = { assetKind: 'bond' as const, planGroup: 'invest' as const, unitKind: 'face' as const, lotSize: null, coretaxSection: 'investasi' as const, coretaxCode: '0305', acquiredYear: 2026 };

beforeEach(async () => {
  ({ database, ws } = await setupDb());
  bank = await createAccount(database, ws, { name: 'Bank Mitra Giro', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 30_000_000, openedOn: '2026-01-01' });
  card = await createAccount(database, ws, { name: 'Mitra Visa', kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  category = (await listAccounts(database, ws)).find((a) => a.kind === 'expense')!.id;
});

const bondBuy = (cashAccountId: string | null) => ({
  kind: 'buy' as const,
  occurredOn: '2026-11-10',
  unitsMicro: 7_000_000 * 1_000_000,
  grossMinor: 7_000_000,
  feeMinor: 15_000,
  taxMinor: 0,
  cashAccountId,
});

describe('openAsset', () => {
  it('opens the holding and records its buy on a card, so the card owes it at once', async () => {
    const opened = await openAsset(database, ws, {
      account: { name: 'ORI031', kind: 'asset', subtype: 'investment', currency: 'IDR' },
      profile: BOND,
      acquired: { on: '2026-11-10', precision: 'day' },
      trades: [{ ...bondBuy(card.id), spendCategoryId: category, mcc: '6211' }],
    });
    expect(await getAssetProfile(database, ws, opened.accountId)).toMatchObject({ assetKind: 'bond', unitKind: 'face', coretaxCode: '0305' });
    expect((await acquiredDates(database, ws))[opened.accountId]).toEqual({ on: '2026-11-10', precision: 'day' });
    const balances = await nativeBalances(database, ws);
    expect(balances[opened.accountId]).toBe(7_015_000);
    // The card is a liability, so what it owes shows as a credit.
    expect(balances[card.id]).toBe(-7_015_000);
    expect(balances[bank.id]).toBe(30_000_000);
    const [trade] = await listTrades(database, ws, { accountId: opened.accountId });
    expect(trade).toMatchObject({ kind: 'buy', cashAccountId: card.id, grossMinor: 7_000_000, feeMinor: 15_000 });
    expect(await postedTradeMoney(database, ws, trade!.id)).toMatchObject({ spendCategoryId: category, mcc: '6211' });
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('comes out the same as adding the holding empty and buying it from Trade', async () => {
    const opened = await openAsset(database, ws, { account: { name: 'ORI031', kind: 'asset', subtype: 'investment', currency: 'IDR' }, profile: BOND, trades: [bondBuy(bank.id)] });
    const empty = await createAccount(database, ws, { name: 'ORI031 by hand', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: empty.id, ...BOND });
    await recordTrade(database, ws, { ...bondBuy(bank.id), accountId: empty.id });
    const balances = await nativeBalances(database, ws);
    expect(balances[opened.accountId]).toBe(balances[empty.id]);
    expect(balances[bank.id]).toBe(30_000_000 - 2 * 7_015_000);
    const values = await assetValuesAt(database, ws, '2026-11-12');
    const of = (id: string) => values.find((v) => v.accountId === id)!;
    expect({ ...of(opened.accountId), accountId: '', name: '' }).toEqual({ ...of(empty.id), accountId: '', name: '' });
  });

  it('leaves nothing behind when the buy cannot be recorded', async () => {
    const before = (await listAccounts(database, ws)).length;
    await expect(
      openAsset(database, ws, { account: { name: 'ORI031', kind: 'asset', subtype: 'investment', currency: 'IDR' }, profile: BOND, trades: [bondBuy('no-such-account')] }),
    ).rejects.toThrow();
    const after = await listAccounts(database, ws);
    expect(after).toHaveLength(before);
    expect(after.some((a) => a.name === 'ORI031')).toBe(false);
    expect(await listTrades(database, ws)).toEqual([]);
  });

  it('still opens past purchases against Opening Balances, with a first value', async () => {
    const opened = await openAsset(database, ws, {
      account: { name: 'Money market fund', kind: 'asset', subtype: 'investment', currency: 'IDR' },
      profile: { assetKind: 'fund', planGroup: 'invest', unitKind: 'units', lotSize: null, coretaxSection: 'investasi', coretaxCode: '0304', acquiredYear: 2025 },
      acquired: { on: '2025-03-01', precision: 'month' },
      trades: [{ kind: 'buy', occurredOn: '2025-03-01', unitsMicro: 0, grossMinor: 4_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: null }],
      valuation: { asOf: '2026-11-12', valueMinor: 4_250_000, basis: 'estimate' },
    });
    expect((await nativeBalances(database, ws))[bank.id]).toBe(30_000_000);
    expect((await listValuations(database, ws, opened.accountId)).map((v) => v.valueMinor)).toEqual([4_250_000]);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });
});

describe('assetValuesAt everSold', () => {
  it('reads a holding with nothing bought yet as never sold, and one a sell emptied as sold', async () => {
    const empty = await openAsset(database, ws, { account: { name: 'SBR015', kind: 'asset', subtype: 'investment', currency: 'IDR' }, profile: BOND, trades: [] });
    const gone = await openAsset(database, ws, { account: { name: 'ORI031', kind: 'asset', subtype: 'investment', currency: 'IDR' }, profile: BOND, trades: [bondBuy(bank.id)] });
    await recordTrade(database, ws, { ...bondBuy(bank.id), accountId: gone.accountId, kind: 'sell', occurredOn: '2026-11-11', feeMinor: 0 });
    const values = await assetValuesAt(database, ws, '2026-11-12');
    expect(values.find((v) => v.accountId === empty.accountId)).toMatchObject({ unitsMicro: 0, everSold: false });
    expect(values.find((v) => v.accountId === gone.accountId)).toMatchObject({ unitsMicro: 0, everSold: true });
  });
});
