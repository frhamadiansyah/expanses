import { countedFromOf, installmentSchedule } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { BookReadOnlyError, withCapture } from '../sync/capture';
import { hasBooks, personalBookIdTx } from './books';
import { uncategorisedIdOf } from './uncategorised';

/*
 * A card instalment plan with no purchase, counted Each month, as it travels (0123, design
 * docs/sdd/card-instalments-c-no-purchase-family.md option a). The plan (card_installments) never leaves this phone; its
 * plan_spreads row is kept in step with it here, and goes to a shared workspace when the category it counts in is one of
 * that workspace's (the plan_spread entity's scope). Another phone counts it from that row, by the same function and
 * figures. A plan with a purchase travels with the purchase instead (its `spread`), and has no row here.
 *
 * `records_from` is the statement date of the plan's first instalment not paid (`countedFromOf`, 0124): another phone
 * counts the same instalments as this one, with no change to what travels.
 */

export async function planSpreadsExist(db: Db): Promise<boolean> {
  return (await db.values(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plan_spreads'`)).length > 0;
}

type Row = [string, number, number, number, string, number, string | null, string];

/** What this phone's plan should read as in plan_spreads, or null when it has no row there. */
async function wantedRowTx(db: Db, ws: WorkspaceContext, planId: string): Promise<Row | null> {
  const withCategory = (await db.values(sql`SELECT 1 FROM pragma_table_info('card_installments') WHERE name = 'category_account_id'`)).length > 0;
  const withPaid = (await db.values(sql`SELECT 1 FROM pragma_table_info('card_installments') WHERE name = 'paid_so_far'`)).length > 0;
  const [plan] = await db.values<[string, string | null, string, string, number, number, number, string, string | null, number]>(sql`
    SELECT card_account_id, transaction_id, count_mode, description, total_minor, monthly_minor, months, first_billed_month,
      ${withCategory ? sql`category_account_id` : sql`NULL`}, ${withPaid ? sql`paid_so_far` : sql`0`}
    FROM card_installments WHERE id = ${planId} AND workspace_id = ${ws.workspaceId}`);
  if (!plan) return null;
  const [cardAccountId, transactionId, countMode, description, totalMinor, monthlyMinor, months, firstBilledMonth, categoryId, paidSoFar] = plan;
  if (transactionId !== null || countMode !== 'each_month') return null;
  const [terms] = await db.values<[number | null]>(sql`SELECT statement_day FROM card_terms WHERE account_id = ${cardAccountId}`);
  const personal = (await hasBooks(db)) ? await personalBookIdTx(db, ws.workspaceId) : null;
  // Left without a category, it counts under Uncategorised of Personal — an id every phone of that workspace shares.
  const category = categoryId ?? (await uncategorisedIdOf(personal ?? ws.workspaceId, 'expense'));
  const statementDay = Number(terms?.[0] ?? 1);
  // Another phone counts what this one does: the instalments after those paid (0124), from the first one's statement date.
  const schedule = installmentSchedule({ totalMinor: Number(totalMinor), months: Number(months), monthlyMinor: Number(monthlyMinor), firstBilledMonth, rateBps: 0, conversionFeeMinor: 0, earnsPoints: false }, statementDay);
  return [description, Number(totalMinor), Number(monthlyMinor), Number(months), firstBilledMonth, statementDay, countedFromOf(schedule, Number(paidSoFar)), category];
}

/**
 * Keeps one of this phone's own plans' plan_spreads row in step with it: written, changed or taken away, captured so a
 * shared workspace gets the change. Called after any write to the plan (what is paid included) or its card's statement day,
 * and on opening the app. A row of a workspace whose share has ended stays as it was.
 */
export async function refreshPlanSpreadTx(db: Db, given: WorkspaceContext, planId: string): Promise<void> {
  if (!(await planSpreadsExist(db))) return;
  const ws = ownerScope(given);
  const wanted = await wantedRowTx(db, ws, planId);
  const [had] = await db.values<Row>(sql`
    SELECT description, total_minor, monthly_minor, months, first_billed_month, statement_day, records_from, category_account_id FROM plan_spreads WHERE id = ${planId}`);
  const current = had ? ([had[0], Number(had[1]), Number(had[2]), Number(had[3]), had[4], Number(had[5]), had[6], had[7]] as Row) : null;
  if (JSON.stringify(current) === JSON.stringify(wanted)) return;
  try {
    await withCapture(db, { entity: 'plan_spread', id: planId }, async () => {
      if (!wanted) {
        await db.run(sql`DELETE FROM plan_spreads WHERE id = ${planId}`);
        return;
      }
      const [description, totalMinor, monthlyMinor, months, firstBilledMonth, statementDay, recordsFrom, category] = wanted;
      await db.run(sql`
        INSERT INTO plan_spreads (id, workspace_id, description, total_minor, monthly_minor, months, first_billed_month, statement_day, records_from, category_account_id)
        VALUES (${planId}, ${ws.workspaceId}, ${description}, ${totalMinor}, ${monthlyMinor}, ${months}, ${firstBilledMonth}, ${statementDay}, ${recordsFrom}, ${category})
        ON CONFLICT (id) DO UPDATE SET description = excluded.description, total_minor = excluded.total_minor, monthly_minor = excluded.monthly_minor,
          months = excluded.months, first_billed_month = excluded.first_billed_month, statement_day = excluded.statement_day,
          records_from = excluded.records_from, category_account_id = excluded.category_account_id`);
    });
  } catch (error) {
    if (!(error instanceof BookReadOnlyError)) throw error;
  }
}

/** Every one of this phone's own plans' rows, in step: what opening the app does, after the auto-link. */
export async function refreshPlanSpreads(database: Database, ws: WorkspaceContext): Promise<void> {
  if (!(await planSpreadsExist(database.db))) return;
  const ids = await database.db.values<[string]>(sql`SELECT id FROM card_installments WHERE workspace_id = ${ownerScope(ws).workspaceId}`);
  for (const [id] of ids) await database.transaction((tx) => refreshPlanSpreadTx(tx, ws, id));
}
