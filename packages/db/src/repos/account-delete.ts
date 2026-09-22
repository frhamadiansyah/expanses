import { and, eq } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database } from '../database';
import { accounts, entries, transactions } from '../schema';
import { goalEarmarks } from '../schema-goals';
import { SYSTEM_ACCOUNTS } from '../seed';
import { AccountError, archiveAccountTx } from './accounts';
import { voidTransactionTx } from './ledger';
import { setAsideTablesExist } from './set-aside-tx';

/** The one entry creation writes for an opening balance, by the words it is posted with. */
const openingDescription = (name: string) => `Opening balance: ${name}`;

/**
 * Deletes an account that was only ever opened: nothing has touched it but the opening balance entry creation
 * wrote, and no goal promises money out of it. This is the way out of a deposit (or any account) opened by
 * mistake — archiving refuses while it still holds a balance, so there would otherwise be no way to take it back
 * without moving its money somewhere first.
 *
 * The opening is voided rather than erased, so the ledger keeps its record, and the account is archived with it.
 * Anything else on the account — and the refusal says to move the money out, then archive.
 */
export async function deleteUnusedAccount(database: Database, ws: WorkspaceContext, id: string): Promise<void> {
  await database.transaction(async (tx) => {
    const [account] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, id), eq(accounts.workspaceId, ws.workspaceId)));
    if (!account) throw new AccountError('Account not found');
    if (SYSTEM_ACCOUNTS.some((s) => s.key === account.systemKey)) throw new AccountError('System accounts cannot be deleted');

    // Every transaction that has touched the account, by the words it was posted with.
    const posted = await tx
      .selectDistinct({ id: transactions.id, description: transactions.description })
      .from(entries)
      .innerJoin(transactions, eq(entries.transactionId, transactions.id))
      .where(and(eq(entries.accountId, id), eq(transactions.status, 'posted')));
    if (posted.length > 1 || (posted.length === 1 && posted[0]!.description !== openingDescription(account.name))) {
      throw new AccountError(`${account.name} has entries of its own. Move the money out, then archive it.`);
    }

    // A promise on the account is a fact about the same money: it has to be answered before the account goes.
    if (await setAsideTablesExist(tx)) {
      const promised = await tx.select({ goalId: goalEarmarks.goalId }).from(goalEarmarks).where(eq(goalEarmarks.accountId, id)).limit(1);
      if (promised.length > 0) throw new AccountError(`${account.name} has money set aside for a goal. Take it back first.`);
    }

    if (posted.length === 1) await voidTransactionTx(tx, ws, posted[0]!.id);
    await archiveAccountTx(tx, ws, id);
  });
}
