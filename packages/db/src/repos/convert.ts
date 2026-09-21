import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { investmentTrades } from '../schema-assets';
import { AssetError, assertAccountInWorkspace } from './assets';
import { voidTransactionTx } from './ledger';
import { setAsideChoiceOfTx, setAsideTablesExist, stillPromisedTx } from './set-aside-tx';
import { writeTradeTx } from './trades';

export interface ConvertToPurchaseInput {
  /** The expense already recorded, or imported from a statement. */
  transactionId: string;
  /** The holding it really bought. */
  accountId: string;
  unitsMicro: number;
  goalId?: string | null;
  feeMinor?: number;
}

export interface ConvertToPurchaseResult {
  tradeId: string;
  /** The purchase written in place of the expense. */
  transactionId: string;
}

/** Money leaves one of these; whichever side went negative paid for the purchase. */
const MONEY_KINDS = ['asset', 'liability'];

/**
 * Turns a transaction recorded as spending into the purchase it actually was, keeping its date,
 * amount and money account. The original is voided, never deleted, and a card purchase keeps its
 * category and MCC so the points still count.
 */
export async function convertToPurchase(database: Database, ws: WorkspaceContext, input: ConvertToPurchaseInput): Promise<ConvertToPurchaseResult> {
  if (!(input.unitsMicro > 0)) throw new AssetError('Enter how many units, shares or grams it bought');

  return database.transaction(async (tx) => {
    await assertAccountInWorkspace(tx, ws, input.accountId, 'Asset');

    const [original] = await tx
      .select({ id: transactions.id, occurredOn: transactions.occurredOn, description: transactions.description, status: transactions.status, mcc: transactions.mcc })
      .from(transactions)
      .where(and(eq(transactions.id, input.transactionId), eq(transactions.workspaceId, ws.workspaceId)));
    if (!original) throw new AssetError('That transaction is not in this workspace');
    if (original.status === 'void') throw new AssetError('That transaction is void, so there is nothing to convert');

    const [asTrade] = await tx
      .select({ id: investmentTrades.id })
      .from(investmentTrades)
      .where(and(eq(investmentTrades.transactionId, input.transactionId), eq(investmentTrades.workspaceId, ws.workspaceId)));
    if (asTrade) throw new AssetError('That transaction is already a purchase');

    const lines = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor, kind: accounts.kind, subtype: accounts.subtype })
      .from(entries)
      .innerJoin(accounts, eq(entries.accountId, accounts.id))
      .where(and(eq(entries.transactionId, input.transactionId), eq(entries.workspaceId, ws.workspaceId)));

    const moneyLine = lines.find((line) => MONEY_KINDS.includes(line.kind) && line.amountMinor < 0);
    if (!moneyLine) throw new AssetError('Cannot tell which account paid for this');
    const grossMinor = -moneyLine.amountMinor - (input.feeMinor ?? 0);
    if (!(grossMinor > 0)) throw new AssetError('The fee cannot be more than what was paid');

    const paidByCard = moneyLine.subtype === 'credit_card';
    const spendCategoryId = paidByCard ? (lines.find((line) => line.kind === 'expense')?.accountId ?? null) : null;

    // A borrow follows the money onto the purchase, unless the purchase is for that same goal. A spend or a move was
    // undone by the void and is not re-applied: buying for a goal lowers that goal's cash promise on its own.
    const carried = (await setAsideTablesExist(tx)) ? await setAsideChoiceOfTx(tx, ws, input.transactionId) : null;
    // As an edit does (replaceTransaction), a borrow from a goal archived or no longer set aside here is dropped, not refused.
    const keep =
      carried && carried.intent === 'borrow' && carried.goalId !== (input.goalId ?? null) && (await stillPromisedTx(tx, ws, carried)) ? carried : null;
    await voidTransactionTx(tx, ws, input.transactionId);
    const result = await writeTradeTx(
      tx,
      ws,
      {
        accountId: input.accountId,
        kind: 'buy',
        occurredOn: original.occurredOn,
        unitsMicro: input.unitsMicro,
        grossMinor,
        feeMinor: input.feeMinor ?? 0,
        taxMinor: 0,
        cashAccountId: moneyLine.accountId,
        goalId: input.goalId ?? null,
        spendCategoryId,
        mcc: original.mcc,
        setAside: keep,
      },
      null,
      // The saved answer, so the carried borrow stands even when the goal's promise there was spent to nought since.
      keep,
    );
    return { tradeId: result.tradeId, transactionId: result.transactionId! };
  });
}
