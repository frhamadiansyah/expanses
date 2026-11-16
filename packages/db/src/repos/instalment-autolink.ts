import { planPurchaseOutcome } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database } from '../database';
import { cardRecordsFrom } from './instalment-spending';
import { countModeColumnExists, listInstallments, setInstallmentCountMode, updateInstallment } from './installments';
import { cardStatementLines } from './statements';

/*
 * The plans saved before a plan could name its purchase (owner, 16 Nov 2026: "I don't want to pick manually"): once per
 * workspace on this device, each plan with no purchase is tied to the one the card's records hold for it — the same
 * total, in its window (`planPurchaseOutcome`) — and counts Each month. One whose purchase is older than the card's
 * records counts Each month with no purchase, from the records' start. Any other is left as it is, At purchase, for the
 * owner to choose, and its page says so. Done once: a plan the owner sets back to None later is never tied again.
 */

/** The device-local key the run is remembered by, per workspace. */
export const instalmentAutoLinkKey = (workspaceId: string) => `instalment-autolink.v1.${workspaceId}`;

export interface AutoLinkReport {
  linked: number;
  /** Counted Each month with no purchase: bought before the card's records start. */
  beforeRecords: number;
  /** Left for the owner: no purchase in the window, or more than one. */
  left: number;
}

/** Runs once per workspace on this device; null when it has run already (or the database is too old for it). */
export async function autoLinkInstalmentPlans(database: Database, given: WorkspaceContext): Promise<AutoLinkReport | null> {
  const ws = ownerScope(given);
  if (!(await countModeColumnExists(database.db))) return null;
  const key = instalmentAutoLinkKey(ws.workspaceId);
  const [done] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${key}`);
  if (done) return null;

  const unlinked = (await listInstallments(database, ws)).filter((plan) => !plan.transactionId);
  const report: AutoLinkReport = { linked: 0, beforeRecords: 0, left: 0 };
  const outcomes: { plan: (typeof unlinked)[number]; outcome: ReturnType<typeof planPurchaseOutcome> }[] = [];
  const cards = new Map<string, { lines: Awaited<ReturnType<typeof cardStatementLines>>; recordsFrom: string | null }>();
  for (const plan of unlinked) {
    if (!cards.has(plan.cardAccountId)) {
      cards.set(plan.cardAccountId, { lines: await cardStatementLines(database, ws, plan.cardAccountId), recordsFrom: await cardRecordsFrom(database.db, ws, plan.cardAccountId) });
    }
    const card = cards.get(plan.cardAccountId)!;
    outcomes.push({ plan, outcome: planPurchaseOutcome(card.lines, plan, card.recordsFrom) });
  }
  // A purchase two plans would both take is neither's: which one it was is the owner's to say.
  const claims = new Map<string, number>();
  for (const { outcome } of outcomes) if (outcome.kind === 'link') claims.set(outcome.transactionId, (claims.get(outcome.transactionId) ?? 0) + 1);

  for (const { plan, outcome } of outcomes) {
    if (outcome.kind === 'link' && claims.get(outcome.transactionId) === 1) {
      // Through the plan's own door, so a shared purchase goes out with its spread.
      await updateInstallment(database, ws, {
        id: plan.id,
        description: plan.description,
        totalMinor: plan.totalMinor,
        months: plan.months,
        firstBilledMonth: plan.firstBilledMonth,
        earnsPoints: plan.earnsPoints,
        transactionId: outcome.transactionId,
        countMode: 'each_month',
      });
      report.linked += 1;
    } else if (outcome.kind === 'before-records') {
      await setInstallmentCountMode(database, ws, plan.id, 'each_month');
      report.beforeRecords += 1;
    } else {
      report.left += 1;
    }
  }
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(report)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  return report;
}
