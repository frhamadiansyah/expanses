import { sql } from 'drizzle-orm';
import type { Db } from '../database';
import { stableId } from '../self/stable-id';
import { billTablesExist } from './bill-months';

/*
 * One payment, several bills (2026-11-22): a bill's month is settled by one posted payment. Each phone checks that before
 * it writes one, but two phones (or two of the owner's own devices) can each pay a month before they sync — one pays
 * Internet and Mobile phone together, the other pays Mobile phone alone. Whatever arrives, every device settles it the
 * same way, so they agree: the month stays with the payment that was made first — the lowest purchase lineage id (a
 * shared purchase's id on every phone), else the lowest transaction id (the same on linked devices); both are time
 * ordered. The other payment's link to that month is let go — never the payment itself, which stays as it was, money
 * and all — and Activity says so. When that link was its own bill (a Pay payment), it becomes a plain purchase.
 */

/** The key a payment is ranked by: its purchase lineage when it heads one, else its own id. */
const RANK = sql.raw(`COALESCE((SELECT l.lineage_id FROM sync_lineage l WHERE l.head_transaction_id = t.id LIMIT 1), t.id)`);

async function lineagesExist(tx: Db): Promise<boolean> {
  return (await tx.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_lineage'`)).length > 0;
}

/**
 * Settles every month of a bill these transactions pay that another posted payment pays too (see above). Call it after
 * writing what arrived from another device: a sync apply, household or linked. Answers how many links were let go.
 */
export async function settleTwicePaidBillsTx(tx: Db, transactionIds: readonly string[]): Promise<number> {
  const ids = [...new Set(transactionIds.filter(Boolean))];
  if (ids.length === 0 || !(await billTablesExist(tx))) return 0;
  const rank = (await lineagesExist(tx)) ? RANK : sql.raw('t.id');
  const twice = await tx.values<[string, string]>(sql`
    SELECT DISTINCT p.template_id, p.bill_month FROM bill_payments p JOIN transactions t ON t.id = p.transaction_id
    WHERE p.transaction_id IN ${ids} AND t.status = 'posted'
      AND EXISTS (
        SELECT 1 FROM bill_payments o JOIN transactions ot ON ot.id = o.transaction_id
        WHERE o.template_id = p.template_id AND o.bill_month = p.bill_month AND o.transaction_id <> p.transaction_id AND ot.status = 'posted')`);
  let dropped = 0;
  for (const [templateId, billMonth] of twice) {
    const holders = await tx.values<[string, string, string | null, string, string]>(sql`
      SELECT t.id, ${rank}, t.template_id, t.workspace_id, t.occurred_on FROM bill_payments p JOIN transactions t ON t.id = p.transaction_id
      WHERE p.template_id = ${templateId} AND p.bill_month = ${billMonth} AND t.status = 'posted'
      ORDER BY 2, t.id`);
    const [kept, ...others] = holders;
    if (!kept) continue;
    for (const [id, , ownBill, workspaceId] of others) {
      await tx.run(sql`DELETE FROM bill_payments WHERE transaction_id = ${id} AND template_id = ${templateId} AND bill_month = ${billMonth}`);
      // Its own bill's month gone, it is a Pay payment of nothing: a plain purchase, so no edit writes the month back.
      if (ownBill === templateId) await tx.run(sql`UPDATE transactions SET template_id = NULL WHERE id = ${id}`);
      const note = await stableId(`${id}|${templateId}|${billMonth}`, 'bill:paid-twice');
      await tx.run(sql`
        INSERT OR IGNORE INTO audit_log (id, workspace_id, action, entity, entity_id, payload_json, created_at)
        VALUES (${note}, ${workspaceId}, 'paid_twice', 'bill_link', ${id}, ${JSON.stringify({ templateId, billMonth, keptBy: kept[0] })}, ${new Date().toISOString()})`);
      dropped += 1;
    }
  }
  return dropped;
}
