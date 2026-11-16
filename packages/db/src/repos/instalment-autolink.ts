import { matchPlanPurchase } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database } from '../database';
import { countModeColumnExists, isTradeTx, listInstallments, updateInstallment } from './installments';
import { cardStatementLines } from './statements';

/*
 * The plans saved before a plan could name its purchase (owner, 16 Nov 2026: "I don't want to pick manually"): once per
 * workspace on this device, each plan with no purchase is tied to the one purchase the card holds for it — the same
 * total, in its window (`matchPlanPurchase`) — and counts Each month (At purchase for an investment). Any other is left
 * as it is: a plan with no purchase is one whose purchase is not in the app. Done once: a plan the owner sets back to
 * None later is never tied again.
 */

/** The device-local key the run is remembered by, per workspace. */
export const instalmentAutoLinkKey = (workspaceId: string) => `instalment-autolink.v1.${workspaceId}`;

export interface AutoLinkReport {
  linked: number;
  /** Left as they were: no purchase of their total in the window, or more than one. */
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
  const report: AutoLinkReport = { linked: 0, left: 0 };
  const matches: { plan: (typeof unlinked)[number]; transactionId: string | null }[] = [];
  const cards = new Map<string, Awaited<ReturnType<typeof cardStatementLines>>>();
  for (const plan of unlinked) {
    if (!cards.has(plan.cardAccountId)) cards.set(plan.cardAccountId, await cardStatementLines(database, ws, plan.cardAccountId));
    matches.push({ plan, transactionId: matchPlanPurchase(cards.get(plan.cardAccountId)!, plan) });
  }
  // A purchase two plans would both take is neither's: which one it was is the owner's to say.
  const claims = new Map<string, number>();
  for (const { transactionId } of matches) if (transactionId) claims.set(transactionId, (claims.get(transactionId) ?? 0) + 1);

  for (const { plan, transactionId } of matches) {
    if (transactionId && claims.get(transactionId) === 1) {
      // Through the plan's own door, so a shared purchase goes out with its spread.
      await updateInstallment(database, ws, {
        id: plan.id,
        description: plan.description,
        totalMinor: plan.totalMinor,
        months: plan.months,
        firstBilledMonth: plan.firstBilledMonth,
        earnsPoints: plan.earnsPoints,
        transactionId,
        // An investment bought with the card is never spending: its plan counts At purchase.
        countMode: (await isTradeTx(database.db, transactionId)) ? 'at_purchase' : 'each_month',
      });
      report.linked += 1;
    } else {
      report.left += 1;
    }
  }
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify(report)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  return report;
}

/** The device-local key the counting repair is remembered by, per workspace. */
export const instalmentCountingKey = (workspaceId: string) => `instalment-counting.v1.${workspaceId}`;

/**
 * The app decides how a plan counts (owner, 16 Nov 2026, TF 139): a plan tied to a spending purchase counts Each month;
 * one tied to an investment buy, or with no purchase and Investment chosen, At purchase (saving). Once per workspace on
 * this device, a plan tied to a spending purchase still At purchase is moved to Each month through `updateInstallment`,
 * so a shared purchase's spread goes out; one tied to a buy and Each month (before the guard) back to At purchase. A plan
 * with no purchase keeps what it has: At purchase now reads as Investment. Null when it has run already.
 */
export async function repairInstalmentCounting(database: Database, given: WorkspaceContext): Promise<{ moved: number } | null> {
  const ws = ownerScope(given);
  if (!(await countModeColumnExists(database.db))) return null;
  const key = instalmentCountingKey(ws.workspaceId);
  const [done] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${key}`);
  if (done) return null;
  let moved = 0;
  for (const plan of await listInstallments(database, ws)) {
    if (!plan.transactionId) continue;
    const wanted = plan.linkedToTrade ? 'at_purchase' : 'each_month';
    if (plan.countMode === wanted) continue;
    await updateInstallment(database, ws, {
      id: plan.id,
      description: plan.description,
      totalMinor: plan.totalMinor,
      months: plan.months,
      firstBilledMonth: plan.firstBilledMonth,
      earnsPoints: plan.earnsPoints,
      countMode: wanted,
    });
    moved += 1;
  }
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify({ moved })}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  return { moved };
}
