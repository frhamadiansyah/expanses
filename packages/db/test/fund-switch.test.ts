import { beforeEach, describe, expect, it } from 'vitest';
import {
  type AccountRow,
  assetValuesAt,
  checkLedgerIntegrity,
  coretaxInputsFor,
  createAccount,
  type Database,
  deleteSwitch,
  deleteTrade,
  getAssetProfile,
  listTrades,
  nativeBalances,
  positionsFor,
  recordSwitch,
  recordTrade,
  recordValuation,
  replaceSwitch,
  replaceTransaction,
  resplitTrade,
  retagTrade,
  replaceTrade,
  saveAssetProfile,
  saveGoal,
  switchOf,
  switchTargets,
  voidTransaction,
  voidTransactionTx,
  type WorkspaceContext,
} from '../src/index';
import { setupDb } from './helpers';

let database: Database;
let ws: WorkspaceContext;
let mm: AccountRow;
let bond: AccountRow;
let bank: AccountRow;

/** Invented figures: 8.000.000 into a money market fund, which the fund app later shows at 10.000.000. */
beforeEach(async () => {
  ({ database, ws } = await setupDb());
  mm = await createAccount(database, ws, { name: 'Money Market Fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: mm.id, assetKind: 'fund', coretaxFields: { inst: 'Fund App' } });
  bond = await createAccount(database, ws, { name: 'Bond Fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
  await saveAssetProfile(database, ws, { accountId: bond.id, assetKind: 'fund' });
  bank = await createAccount(database, ws, { name: 'Everyday bank', kind: 'asset', subtype: 'bank', currency: 'IDR', openingBalanceMinor: 20_000_000, openedOn: '2026-01-01' });
  await buy(mm.id, '2026-02-01', 8_000_000);
  await recordValuation(database, ws, { accountId: mm.id, asOf: '2026-09-30', valueMinor: 10_000_000, basis: 'estimate' });
});

const buy = (accountId: string, occurredOn: string, grossMinor: number) =>
  recordTrade(database, ws, { accountId, kind: 'buy', occurredOn, unitsMicro: 0, grossMinor, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });

const valuesOn = async (date: string) => {
  const rows = await assetValuesAt(database, ws, date);
  return { mm: rows.find((row) => row.accountId === mm.id)!, bond: rows.find((row) => row.accountId === bond.id)! };
};

const switchOut = (amountMinor: number, feeMinor = 0, occurredOn = '2026-10-23') =>
  recordSwitch(database, ws, { fromAccountId: mm.id, to: { accountId: bond.id }, occurredOn, amountMinor, feeMinor });

describe('Switch between two funds tracked by money', () => {
  it('moves the money and its share of the cost, with no cash account touched and no profit booked', async () => {
    const result = await switchOut(5_000_000);
    expect(result.basisMinor).toBe(4_000_000);

    const { mm: from, bond: into } = await valuesOn('2026-10-23');
    expect(from).toMatchObject({ valueMinor: 5_000_000, costMinor: 4_000_000 });
    expect(into).toMatchObject({ valueMinor: 5_000_000, costMinor: 4_000_000 });
    const positions = await positionsFor(database, ws);
    expect(positions[mm.id]).toMatchObject({ costMinor: 4_000_000, realizedMinor: 0 });
    expect(positions[bond.id]).toMatchObject({ costMinor: 4_000_000, realizedMinor: 0 });

    const balances = await nativeBalances(database, ws);
    expect(balances[bank.id]).toBe(12_000_000);
    expect(balances[mm.id]).toBe(4_000_000);
    expect(balances[bond.id]).toBe(4_000_000);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('files both funds on the tax report at their year-end values, the money in moved, and no profit realised', async () => {
    await switchOut(5_000_000, 25_000);
    const inputs = await coretaxInputsFor(database, ws, 2026);
    const from = inputs.holdings.find((holding) => holding.accountId === mm.id);
    const into = inputs.holdings.find((holding) => holding.accountId === bond.id);
    expect(from).toMatchObject({ code: '0307', valueMinor: 5_000_000, byYear: { '2026': { costMinor: 4_000_000 } } });
    expect(into).toMatchObject({ code: '0307', valueMinor: 4_975_000, byYear: { '2026': { costMinor: 4_000_000 } } });
    // Nothing reached the Realized Gains category: the switch posted the two funds' lines alone.
    const trades = await listTrades(database, ws);
    const { entries } = await import('../src/schema');
    const { eq } = await import('drizzle-orm');
    const lines = await database.db.select({ accountId: entries.accountId, amountMinor: entries.amountMinor }).from(entries).where(eq(entries.transactionId, trades.find((trade) => trade.switchedWith)!.transactionId!));
    expect(lines.map((line) => [line.accountId, line.amountMinor]).sort()).toEqual([[bond.id, 4_000_000], [mm.id, -4_000_000]].sort());
  });

  it('keeps both sides as one switch: each knows the other, with the cost carried on both', async () => {
    const result = await switchOut(5_000_000);
    const trades = await listTrades(database, ws);
    const out = trades.find((trade) => trade.id === result.outTradeId)!;
    const into = trades.find((trade) => trade.id === result.inTradeId)!;
    expect(out).toMatchObject({ kind: 'sell', accountId: mm.id, grossMinor: 5_000_000, basisMinor: 4_000_000, cashAccountId: null, switchId: result.switchId, switchedWith: { tradeId: into.id, accountId: bond.id } });
    expect(into).toMatchObject({ kind: 'buy', accountId: bond.id, grossMinor: 5_000_000, basisMinor: 4_000_000, cashAccountId: null, switchId: result.switchId, switchedWith: { tradeId: out.id, accountId: mm.id } });
    expect(out.transactionId).toBe(into.transactionId);
    // An ordinary trade is no switch.
    expect(trades.find((trade) => trade.accountId === mm.id && trade.kind === 'buy')?.switchedWith).toBeUndefined();
    expect((await switchOf(database, ws, into.id))?.out.id).toBe(out.id);
  });

  it('takes a fee out of what arrives: the two funds are worth the fee less, holding the same money in', async () => {
    const before = (await valuesOn('2026-10-22')).mm.valueMinor;
    await switchOut(5_000_000, 25_000);
    const { mm: from, bond: into } = await valuesOn('2026-10-23');
    expect(into).toMatchObject({ valueMinor: 4_975_000, costMinor: 4_000_000 });
    expect(before - (from.valueMinor + into.valueMinor)).toBe(25_000);
    expect(from.costMinor + into.costMinor).toBe(8_000_000);
    const into_ = (await listTrades(database, ws)).find((trade) => trade.accountId === bond.id)!;
    expect(into_).toMatchObject({ grossMinor: 4_975_000, feeMinor: 25_000 });
  });

  it('switches the whole position: the fund left holds nothing, the other everything', async () => {
    await switchOut(10_000_000);
    const { mm: from, bond: into } = await valuesOn('2026-10-23');
    expect(from).toMatchObject({ valueMinor: 0, costMinor: 0 });
    expect(into).toMatchObject({ valueMinor: 10_000_000, costMinor: 8_000_000 });
  });

  it('carries the gain on: a later sell of the fund it went into books it there', async () => {
    await switchOut(5_000_000);
    await recordTrade(database, ws, { accountId: bond.id, kind: 'sell', occurredOn: '2026-10-25', unitsMicro: 0, grossMinor: 5_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });
    expect((await positionsFor(database, ws))[bond.id]).toMatchObject({ costMinor: 0, realizedMinor: 1_000_000 });
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('adds to a fund that already has a value typed, by what arrives', async () => {
    await buy(bond.id, '2026-03-01', 3_000_000);
    await recordValuation(database, ws, { accountId: bond.id, asOf: '2026-09-30', valueMinor: 3_200_000, basis: 'estimate' });
    await switchOut(5_000_000);
    expect((await valuesOn('2026-10-23')).bond).toMatchObject({ valueMinor: 8_200_000, costMinor: 7_000_000 });
  });

  it('refuses more than the fund holds, a fund into itself, and a fund in another currency', async () => {
    await expect(switchOut(10_000_001)).rejects.toThrow(/up to what Money Market Fund is worth/);
    await expect(recordSwitch(database, ws, { fromAccountId: mm.id, to: { accountId: mm.id }, occurredOn: '2026-10-23', amountMinor: 1_000_000, feeMinor: 0 })).rejects.toThrow(/into itself/);
    const usd = await createAccount(database, ws, { name: 'Dollar Fund', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: usd.id, assetKind: 'fund' });
    await expect(recordSwitch(database, ws, { fromAccountId: mm.id, to: { accountId: usd.id }, occurredOn: '2026-10-23', amountMinor: 1_000_000, feeMinor: 0 })).rejects.toThrow(/funds in IDR for now/);
    await expect(recordSwitch(database, ws, { fromAccountId: mm.id, to: { accountId: bank.id }, occurredOn: '2026-10-23', amountMinor: 1_000_000, feeMinor: 0 })).rejects.toThrow(/tracked by money/);
    await expect(switchOut(1_000_000, 1_000_000)).rejects.toThrow(/fee takes the whole amount/);
    expect((await listTrades(database, ws)).length).toBe(1);
  });

  it('edits both sides from either side: a new amount, fee and fund, the cost worked out again', async () => {
    const first = await switchOut(5_000_000);
    const cash = await createAccount(database, ws, { name: 'Equity Fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: cash.id, assetKind: 'fund' });

    const edited = await replaceSwitch(database, ws, first.inTradeId, { fromAccountId: mm.id, to: { accountId: cash.id }, occurredOn: '2026-10-20', amountMinor: 2_500_000, feeMinor: 10_000 });
    expect(edited.basisMinor).toBe(2_000_000);
    const trades = await listTrades(database, ws);
    expect(trades.filter((trade) => trade.switchedWith)).toHaveLength(2);
    expect(trades.some((trade) => trade.id === first.outTradeId || trade.id === first.inTradeId)).toBe(false);
    const rows = await assetValuesAt(database, ws, '2026-10-23');
    expect(rows.find((row) => row.accountId === mm.id)).toMatchObject({ valueMinor: 7_500_000, costMinor: 6_000_000 });
    expect(rows.find((row) => row.accountId === cash.id)).toMatchObject({ valueMinor: 2_490_000, costMinor: 2_000_000 });
    expect(rows.find((row) => row.accountId === bond.id)).toMatchObject({ valueMinor: 0, costMinor: 0 });
    const balances = await nativeBalances(database, ws);
    expect(balances[mm.id]).toBe(6_000_000);
    expect(balances[cash.id]).toBe(2_000_000);
    expect(balances[bond.id] ?? 0).toBe(0);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('deletes both sides from either side, by Delete on the switch or on one trade', async () => {
    const first = await switchOut(5_000_000);
    await deleteSwitch(database, ws, first.outTradeId);
    expect(await listTrades(database, ws)).toHaveLength(1);
    expect((await valuesOn('2026-10-23')).mm).toMatchObject({ valueMinor: 10_000_000, costMinor: 8_000_000 });
    expect((await nativeBalances(database, ws))[bond.id] ?? 0).toBe(0);

    const second = await switchOut(5_000_000);
    await deleteTrade(database, ws, second.inTradeId);
    expect(await listTrades(database, ws)).toHaveLength(1);
    expect((await nativeBalances(database, ws))[mm.id]).toBe(8_000_000);
    await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
  });

  it('refuses to edit one side alone as an ordinary trade', async () => {
    const first = await switchOut(5_000_000);
    await expect(
      replaceTrade(database, ws, first.inTradeId, { accountId: bond.id, kind: 'buy', occurredOn: '2026-10-23', unitsMicro: 0, grossMinor: 1, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id }),
    ).rejects.toThrow(/changed as a whole/);
    expect((await listTrades(database, ws)).filter((trade) => trade.switchedWith)).toHaveLength(2);
  });

  it('opens a new fund by name to switch into, held at the same place', async () => {
    const result = await recordSwitch(database, ws, { fromAccountId: mm.id, to: { newFundName: '  Index Fund ' }, occurredOn: '2026-10-23', amountMinor: 3_000_000, feeMinor: 0 });
    const profile = await getAssetProfile(database, ws, result.toAccountId);
    expect(profile).toMatchObject({ assetKind: 'fund', coretaxFields: { inst: 'Fund App' } });
    const rows = await assetValuesAt(database, ws, '2026-10-23');
    expect(rows.find((row) => row.accountId === result.toAccountId)).toMatchObject({ name: 'Index Fund', mode: 'amount', valueMinor: 3_000_000, costMinor: 2_400_000 });
  });

  it('takes only money with no goal', async () => {
    const goal = { id: await saveGoal(database, ws, { name: 'House', kind: 'home', growthBps: 0, returnBps: 0, stages: [{ name: 'Down payment', targetMinor: 50_000_000, targetMonths: null, dueOn: '2030-06-30' }] }) };
    const tagged = (await listTrades(database, ws))[0]!;
    await replaceTrade(database, ws, tagged.id, { accountId: mm.id, kind: 'buy', occurredOn: '2026-02-01', unitsMicro: 0, grossMinor: 8_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id, goalId: goal.id });
    await expect(switchOut(5_000_000)).rejects.toThrow(/goal’s money/);
  });

  it('offers the other open funds in the same currency to switch into', async () => {
    const usd = await createAccount(database, ws, { name: 'Dollar Fund', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: usd.id, assetKind: 'fund' });
    const gold = await createAccount(database, ws, { name: 'Gold bars', kind: 'asset', subtype: 'investment', currency: 'IDR' });
    await saveAssetProfile(database, ws, { accountId: gold.id, assetKind: 'gold' });
    expect(await switchTargets(database, ws, mm.id)).toEqual([{ accountId: bond.id, name: 'Bond Fund' }]);
  });

  it('refuses a fund outside the base currency on either side, before anything is opened or posted', async () => {
    const usd = await createAccount(database, ws, { name: 'Dollar Fund', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: usd.id, assetKind: 'fund' });
    const usd2 = await createAccount(database, ws, { name: 'Dollar Bond Fund', kind: 'asset', subtype: 'investment', currency: 'USD' });
    await saveAssetProfile(database, ws, { accountId: usd2.id, assetKind: 'fund' });
    await expect(recordSwitch(database, ws, { fromAccountId: usd.id, to: { accountId: usd2.id }, occurredOn: '2026-10-23', amountMinor: 100, feeMinor: 0 })).rejects.toThrow(/funds in IDR for now/);
    await expect(recordSwitch(database, ws, { fromAccountId: usd.id, to: { newFundName: 'Dollar Index Fund' }, occurredOn: '2026-10-23', amountMinor: 100, feeMinor: 0 })).rejects.toThrow(/funds in IDR for now/);
    expect(await switchTargets(database, ws, usd.id)).toEqual([]);
    expect((await assetValuesAt(database, ws, '2026-10-23')).some((row) => row.name === 'Dollar Index Fund')).toBe(false);
  });

  describe('once the money it moved was sold from the fund it went into', () => {
    const sellAllOfBond = () =>
      recordTrade(database, ws, { accountId: bond.id, kind: 'sell', occurredOn: '2026-10-25', unitsMicro: 0, grossMinor: 5_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });

    it('refuses to delete it, from either door, and leaves both funds as they were', async () => {
      const first = await switchOut(5_000_000);
      await sellAllOfBond();
      const before = await positionsFor(database, ws);
      await expect(deleteSwitch(database, ws, first.outTradeId)).rejects.toThrow('Money from this switch was sold since. Delete those sells first.');
      await expect(deleteTrade(database, ws, first.inTradeId)).rejects.toThrow(/sold since/);
      expect(await positionsFor(database, ws)).toEqual(before);
      expect((await listTrades(database, ws)).filter((trade) => trade.switchedWith)).toHaveLength(2);
      await expect(checkLedgerIntegrity(database, ws)).resolves.toEqual([]);
    });

    it('refuses to shrink it or send it elsewhere, but lets it grow', async () => {
      const first = await switchOut(5_000_000);
      await sellAllOfBond();
      const other = await createAccount(database, ws, { name: 'Equity Fund', kind: 'asset', subtype: 'investment', currency: 'IDR' });
      await saveAssetProfile(database, ws, { accountId: other.id, assetKind: 'fund' });
      const edit = (to: string, amountMinor: number) => replaceSwitch(database, ws, first.outTradeId, { fromAccountId: mm.id, to: { accountId: to }, occurredOn: '2026-10-23', amountMinor, feeMinor: 0 });
      await expect(edit(bond.id, 2_500_000)).rejects.toThrow(/sold since/);
      await expect(edit(other.id, 5_000_000)).rejects.toThrow(/sold since/);
      expect((await listTrades(database, ws)).find((trade) => trade.id === first.inTradeId)).toBeDefined();
      const grown = await edit(bond.id, 6_000_000);
      expect(grown.basisMinor).toBe(4_800_000);
    });
  });

  it('refuses a switch dated before a sell from the fund it leaves that needs the money', async () => {
    await recordTrade(database, ws, { accountId: mm.id, kind: 'sell', occurredOn: '2026-10-25', unitsMicro: 0, grossMinor: 10_000_000, feeMinor: 0, taxMinor: 0, cashAccountId: bank.id });
    await expect(switchOut(5_000_000, 0, '2026-10-23')).rejects.toThrow(/sold money after that day/);
    expect((await listTrades(database, ws)).some((trade) => trade.switchedWith)).toBe(false);
  });

  it('keeps each side’s saved time when edited, so the same day’s order stays', async () => {
    const first = await switchOut(5_000_000);
    const before = await listTrades(database, ws);
    await replaceSwitch(database, ws, first.outTradeId, { fromAccountId: mm.id, to: { accountId: bond.id }, occurredOn: '2026-10-23', amountMinor: 4_000_000, feeMinor: 0 });
    const after = await listTrades(database, ws);
    const timeOf = (rows: typeof before, accountId: string) => rows.find((trade) => trade.accountId === accountId && trade.switchedWith)!.createdAt;
    expect(timeOf(after, mm.id)).toBe(timeOf(before, mm.id));
    expect(timeOf(after, bond.id)).toBe(timeOf(before, bond.id));
  });

  it('cannot be voided or edited from the ledger’s own doors; a change applied from another member retires both sides', async () => {
    const first = await switchOut(5_000_000);
    await expect(voidTransaction(database, ws, first.switchId)).rejects.toThrow(/Switch on either fund’s page/);
    await expect(
      replaceTransaction(database, ws, first.switchId, { occurredOn: '2026-10-23', description: 'Edited', lines: [{ accountId: mm.id, amountMinor: -1, currency: 'IDR' }, { accountId: bond.id, amountMinor: 1, currency: 'IDR' }] }),
    ).rejects.toThrow(/Switch on either fund’s page/);
    expect((await switchOf(database, ws, first.inTradeId))?.out.id).toBe(first.outTradeId);

    await database.transaction((tx) => voidTransactionTx(tx, ws, first.switchId, {}, 'another-member'));
    expect(await switchOf(database, ws, first.inTradeId)).toBeNull();
    expect(await listTrades(database, ws)).toHaveLength(1);
    expect((await valuesOn('2026-10-23')).mm).toMatchObject({ valueMinor: 10_000_000, costMinor: 8_000_000 });
  });

  it('gives neither side a goal', async () => {
    const first = await switchOut(5_000_000);
    const goalId = await saveGoal(database, ws, { name: 'House', kind: 'home', growthBps: 0, returnBps: 0, stages: [{ name: 'Down payment', targetMinor: 50_000_000, targetMonths: null, dueOn: '2030-06-30' }] });
    await expect(retagTrade(database, ws, first.inTradeId, goalId)).rejects.toThrow('A switch takes only money with no goal');
    await expect(resplitTrade(database, ws, first.outTradeId, [{ goalId, moneyMinor: 1_000_000, unitsMicro: 0 }])).rejects.toThrow('A switch takes only money with no goal');
  });
});
