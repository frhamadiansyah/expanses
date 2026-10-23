import { assetValueAt, byMoneyInputs, GoalError, goalMoneyOf, moneyPositionAfter, presetFor, switchPlan, type TradeRecord, uuidv7 } from '@expanses/core';
import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles, investmentTrades } from '../schema-assets';
import { createAccountTx } from './accounts';
import { AssetError, assertAccountInWorkspace, getAssetProfileTx, saveAssetProfileTx } from './assets';
import { basisColumnExists, byMoneyHistoryTx, isByMoneyTx, setTradeBasisTx } from './by-money';
import { postTransactionTx } from './ledger';
import { activeTrades, type RecalculatedSell, recalculateSells, retireSwitchTx, switchPairTx, type TradeRow } from './trades';

/*
 * Switch (owner's mockup, 23 Oct 2026): money moved from one fund tracked by money straight into another, with no cash
 * account touched — the fund app's own "switching". One step, stored as the two trades it is — a sell out of the fund it
 * leaves and a buy into the fund it goes to — posted as one ledger transaction, which is what ties them (no column of
 * its own, so no migration):
 *
 *   the fund it leaves   −cost carried
 *   the fund it goes to  +cost carried
 *
 * The cost carried is the share of the money still in the fund it leaves that the amount is of its value just before
 * (`moneySellBasis`), saved on both trades (`basis_minor`). The fund it leaves gives that cost up and books no profit;
 * the fund it goes to takes it as its cost, so neither shows a gain or a loss the switch did not make, and the gain
 * already made travels on, realised when the money is sold out for good. A fee is taken out of what arrives and stays
 * in the cost, as a buy's fee is part of what it cost: the two funds together are worth the fee less, holding the same
 * money in.
 */

export interface SwitchInput {
  /** The fund the money leaves. */
  fromAccountId: string;
  /** The fund it goes into — or a new one, by name, opened as a fund in the same currency at the same Held at. */
  to: { accountId: string } | { newFundName: string };
  occurredOn: string;
  /** What leaves the fund, at its value. */
  amountMinor: number;
  /** Taken on the way: what arrives is the amount less this. */
  feeMinor: number;
  ratesToBase?: Record<string, number>;
}

export interface SwitchResult {
  /** The switch's own id: the ledger transaction both trades share. */
  switchId: string;
  outTradeId: string;
  inTradeId: string;
  toAccountId: string;
  /** What left with the money: the cost it took out of the one fund and put into the other. */
  basisMinor: number;
  recalculatedSells: RecalculatedSell[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function fundOf(tx: Db, ws: WorkspaceContext, accountId: string): Promise<{ id: string; name: string; currency: string }> {
  await assertAccountInWorkspace(tx, ws, accountId, 'Fund');
  const [row] = await tx
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!row || !(await isByMoneyTx(tx, ws, accountId))) throw new AssetError('Only a fund tracked by money can switch');
  return { id: row.id, name: row.name, currency: row.currency ?? ws.baseCurrency };
}

/** A fund opened by name to switch into: a fund in the same currency, held at the same place as the one it comes from. */
async function openFundTx(tx: Db, ws: WorkspaceContext, name: string, from: { id: string; currency: string }): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new AssetError('Name the fund');
  const account = await createAccountTx(tx, ws, { name: trimmed, kind: 'asset', subtype: 'investment', currency: from.currency });
  const heldAt = (await getAssetProfileTx(tx, ws, from.id))?.coretaxFields.inst?.trim();
  await saveAssetProfileTx(tx, ws, { accountId: account.id, assetKind: 'fund', ...(heldAt ? { coretaxFields: { inst: heldAt } } : {}) });
  return account.id;
}

/** Writes one switch, both trades and their transaction, inside an open database transaction. */
async function writeSwitchTx(tx: Db, ws: WorkspaceContext, input: SwitchInput, replaces: { out: TradeRow; into: TradeRow } | null): Promise<SwitchResult> {
  if (!DATE.test(input.occurredOn)) throw new AssetError('A switch needs a date');
  if (!(await basisColumnExists(tx))) throw new AssetError('Reopen the app to finish updating it, then switch');
  const from = await fundOf(tx, ws, input.fromAccountId);
  const toAccountId = 'accountId' in input.to ? input.to.accountId : await openFundTx(tx, ws, input.to.newFundName, from);
  if (toAccountId === from.id) throw new AssetError('A fund cannot switch into itself; choose another fund');
  const to = await fundOf(tx, ws, toAccountId);
  if (to.currency !== from.currency) throw new AssetError(`A switch stays in one currency: ${to.name} is in ${to.currency}, ${from.name} in ${from.currency}`);

  // The fund it leaves, just before: the money still in it and its value, as a sell from it reads them.
  const trades = await activeTrades(tx, ws, from.id);
  const position = moneyPositionAfter(trades, input.occurredOn);
  const history = await byMoneyHistoryTx(tx, ws, from.id);
  const before = assetValueAt(
    { accountId: from.id, mode: 'amount', currency: from.currency, ledgerBalanceMinor: 0, ...byMoneyInputs(trades, history.prices, history.valuations, input.occurredOn) },
    input.occurredOn,
  );
  if (input.amountMinor > before.valueMinor) throw new AssetError(`A switch can take up to what ${from.name} is worth that day`);
  const plan = switchPlan({ costMinor: position.costMinor, valueBeforeMinor: before.valueMinor, amountMinor: input.amountMinor, feeMinor: input.feeMinor });
  // Nothing of the money put in would move: there is no cost to carry, and nothing to post.
  if (plan.basisMinor <= 0) throw new AssetError(`${from.name} has no money put in left to switch`);

  // Money a goal put in stays that goal's: a switch takes only money with no goal, as a sell named to no goal does.
  const probe: TradeRecord = {
    id: '\u0000probe', accountId: from.id, kind: 'sell', occurredOn: input.occurredOn, createdAt: '￿', unitsMicro: 0,
    grossMinor: input.amountMinor, feeMinor: 0, taxMinor: 0, goalId: null, basisMinor: plan.basisMinor, switchId: '\u0000probe',
  };
  try {
    goalMoneyOf([...trades, probe]);
  } catch (e) {
    if (!(e instanceof GoalError)) throw e;
    throw new AssetError(`Part of ${from.name} is a goal’s money; a switch takes only money with no goal`);
  }

  const switchId = await postTransactionTx(tx, ws, {
    occurredOn: input.occurredOn,
    description: `Switched ${from.name} into ${to.name}`,
    lines: [
      { accountId: from.id, amountMinor: -plan.basisMinor, currency: from.currency },
      { accountId: to.id, amountMinor: plan.basisMinor, currency: to.currency },
    ],
    ratesToBase: input.ratesToBase,
  });
  const createdAt = new Date().toISOString();
  const outTradeId = uuidv7();
  const inTradeId = uuidv7();
  const common = { workspaceId: ws.workspaceId, transactionId: switchId, occurredOn: input.occurredOn, unitsMicro: 0, taxMinor: 0, cashAccountId: null, goalId: null, templateId: null, status: 'active' as const, createdAt };
  await tx.insert(investmentTrades).values([
    { ...common, id: outTradeId, accountId: from.id, kind: 'sell', grossMinor: input.amountMinor, feeMinor: 0, replacesTradeId: replaces?.out.id ?? null },
    { ...common, id: inTradeId, accountId: to.id, kind: 'buy', grossMinor: plan.intoMinor, feeMinor: input.feeMinor, replacesTradeId: replaces?.into.id ?? null },
  ]);
  await setTradeBasisTx(tx, outTradeId, plan.basisMinor);
  await setTradeBasisTx(tx, inTradeId, plan.basisMinor);
  const recalculatedSells = [
    ...(await recalculateSells(tx, ws, from.id, input.occurredOn, input.ratesToBase)),
    ...(await recalculateSells(tx, ws, to.id, input.occurredOn, input.ratesToBase)),
  ];
  return { switchId, outTradeId, inTradeId, toAccountId: to.id, basisMinor: plan.basisMinor, recalculatedSells };
}

/** Switches money from one fund tracked by money into another, in one database transaction. */
export function recordSwitch(database: Database, ws: WorkspaceContext, input: SwitchInput): Promise<SwitchResult> {
  return database.transaction((tx) => writeSwitchTx(tx, ws, input, null));
}

/** The switch a trade is one side of, both sides; null when it is no switch. Reads only. */
export async function switchOf(database: Database, ws: WorkspaceContext, tradeId: string): Promise<{ out: TradeRow; into: TradeRow } | null> {
  return switchPairTx(database.db, ws, tradeId);
}

/**
 * Edits a switch from either side: both trades and their transaction are retired and a fresh switch is written, so the
 * cost carried is worked out again from the fund it now leaves, as it stands without the old switch.
 */
export function replaceSwitch(database: Database, ws: WorkspaceContext, tradeId: string, input: SwitchInput): Promise<SwitchResult> {
  return database.transaction(async (tx) => {
    const pair = await switchPairTx(tx, ws, tradeId);
    if (!pair) throw new AssetError('That switch was already changed or removed');
    await retireSwitchTx(tx, ws, pair, 'replaced');
    const result = await writeSwitchTx(tx, ws, input, pair);
    const done = new Set(result.recalculatedSells.map((sell) => sell.tradeId));
    const more: RecalculatedSell[] = [];
    for (const side of [pair.out, pair.into]) {
      const from = side.occurredOn < input.occurredOn ? side.occurredOn : input.occurredOn;
      for (const sell of await recalculateSells(tx, ws, side.accountId, from, input.ratesToBase)) {
        if (!done.has(sell.tradeId)) more.push(sell);
        done.add(sell.tradeId);
      }
    }
    return { ...result, recalculatedSells: [...result.recalculatedSells, ...more] };
  });
}

/** Deletes a switch from either side: the money goes back to the fund it left, and the other fund loses it. */
export function deleteSwitch(database: Database, ws: WorkspaceContext, tradeId: string): Promise<void> {
  return database.transaction(async (tx) => {
    const pair = await switchPairTx(tx, ws, tradeId);
    if (!pair) throw new AssetError('That switch was already changed or removed');
    await retireSwitchTx(tx, ws, pair, 'deleted');
    for (const side of [pair.out, pair.into]) await recalculateSells(tx, ws, side.accountId, side.occurredOn, undefined);
  });
}

/** Every fund a switch can go into from this one: the other funds tracked by money in its currency, still open. */
export async function switchTargets(database: Database, ws: WorkspaceContext, fromAccountId: string): Promise<{ accountId: string; name: string }[]> {
  const rows = await database.db
    .select({ id: accounts.id, name: accounts.name, currency: accounts.currency, archivedAt: accounts.archivedAt, assetKind: assetProfiles.assetKind })
    .from(accounts)
    .innerJoin(assetProfiles, eq(assetProfiles.accountId, accounts.id))
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  const from = rows.find((row) => row.id === fromAccountId);
  if (!from) return [];
  const currencyOf = (row: { currency: string | null }) => row.currency ?? ws.baseCurrency;
  return rows
    .filter((row) => row.id !== fromAccountId && row.archivedAt === null && presetFor(row.assetKind).valuationMode === 'amount' && currencyOf(row) === currencyOf(from))
    .map((row) => ({ accountId: row.id, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
