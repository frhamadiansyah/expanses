import { sql } from 'drizzle-orm';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkLedgerIntegrity } from '../../src/index';
import { Household, memberOf, type Device } from './household';
import { play, programArb } from './programs';

/*
 * Spec §13 `money-atom`: after every apply, on the device that applied — each posted row's entries sum to zero (per
 * currency, in the book's currency too); each lineage has at most one posted row; every money-side entry names a real
 * local account or the payer's placeholder.
 */
const RUNS = Number(process.env.MONEY_ATOM_RUNS ?? 100);

async function checkAtoms(d: Device, bookId: string): Promise<void> {
  expect(await checkLedgerIntegrity(d.database, d.ws)).toEqual([]);
  const baseDrift = await d.database.db.values<[string, number]>(sql`
    SELECT e.transaction_id, sum(e.amount_base_minor) FROM entries e JOIN transactions t ON t.id = e.transaction_id
    WHERE t.status = 'posted' AND t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})
    GROUP BY e.transaction_id, e.currency HAVING sum(e.amount_base_minor) <> 0`);
  expect(baseDrift).toEqual([]);
  const lineages = await d.database.db.values<[string, string | null, string]>(sql`SELECT lineage_id, head_transaction_id, paid_by FROM sync_lineage WHERE book_id = ${bookId}`);
  const me = await memberOf(d.database, bookId);
  for (const [lineageId, head, paidBy] of lineages) {
    const posted = await d.database.db.values<[string]>(sql`
      WITH RECURSIVE forward(id) AS (SELECT ${lineageId} UNION ALL SELECT t.id FROM transactions t JOIN forward f ON t.replaces_transaction_id = f.id)
      SELECT t.id FROM transactions t JOIN forward f ON f.id = t.id
      WHERE t.status = 'posted' AND t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId})`);
    expect(posted.length).toBeLessThanOrEqual(1);
    expect(posted.map((r) => r[0])).toEqual(head ? [head] : []);
    if (!head) continue;
    const side = await d.database.db.values<[string, string | null, string | null]>(sql`
      SELECT e.account_id, a.id, (SELECT m.member_id FROM book_member_accounts m WHERE m.account_id = e.account_id)
      FROM entries e LEFT JOIN accounts a ON a.id = e.account_id AND a.workspace_id = ${d.ws.workspaceId}
      WHERE e.transaction_id = ${head} AND (a.kind IS NULL OR a.kind NOT IN ('income', 'expense'))`);
    for (const [accountId, local, placeholderOf] of side) {
      expect(local, `money side ${accountId} of ${lineageId} is not a local account`).toBe(accountId);
      if (placeholderOf !== null) expect(placeholderOf).toBe(paidBy);
      else expect(paidBy).toBe(me);
    }
  }
}

describe('money is one atom', () => {
  it(`after every apply, over ${RUNS} random programs`, async () => {
    await fc.assert(
      fc.asyncProperty(programArb({ maxSteps: 20, maxHistory: 5 }), async (program) => {
        const home = new Household();
        await play(home, program, (d) => checkAtoms(d, home.bookId));
      }),
      { numRuns: RUNS, seed: 20260928, endOnFailure: true },
    );
  }, 900_000);
});
