import { type CardInstallment, clampPaidSoFar, isoDate, openingBalanceLines, owedAfter, paidSoFarOn } from '@expanses/core';
import { sql } from 'drizzle-orm';
import { ownerScope, type WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { systemAccountId } from './accounts';
import { postTransactionTx, voidTransactionTx } from './ledger';
import { refreshPlanSpreadTx } from './plan-spreads';

/*
 * A card instalment plan with no purchase in the app (owner, 17 Nov 2026): one plain rule. It keeps how many of its
 * instalments are paid (`paid_so_far`, 0124); the rest is owed, and is posted once on the card as a balance line — the
 * plan's owed line — dated the day the plan was added, against Opening Balances like any opening balance (not spending,
 * not income, not in Cashflow), found by its ref `plan-owed:<plan>`. Wallet and net worth read the debt from it; the
 * statements bill the owed instalments a month at a time out of it, as they do out of an opening balance. Ticking the
 * plan's list, changing its figures or removing it brings the line in step (`refreshPlanOwedTx`); asking again changes
 * nothing.
 *
 * A card with an opening balance of its own posts no owed line: that balance is what the bank said was owed on its day,
 * the plan's months still to bill included, so a line beside it would hold the debt twice. Its statements bill the owed
 * instalments out of the opening instead.
 */

export const PLAN_OWED_REF = 'plan-owed:';
export const planOwedRef = (planId: string) => `${PLAN_OWED_REF}${planId}`;

/** The ref a purchase's paid-off-before-the-app settlement carries (ledger's `beforeAppRef`). */
const BEFORE_APP = 'before-app:';

/** For a query with `t` as transactions: a line that sets no balance of its own — a before-the-app settlement or a plan's owed line. */
export const balanceLineRef = sql`(t.external_ref LIKE ${BEFORE_APP + '%'} OR t.external_ref LIKE ${PLAN_OWED_REF + '%'})`;

/** The day a plan was added, on this phone's calendar. */
export const addedOnOf = (createdAt: string): string => isoDate(new Date(createdAt));

const paidColumn = new WeakMap<Db, boolean>();

/** Whether 0124 is here: before it no plan keeps what is paid. */
export async function paidSoFarColumnExists(db: Db): Promise<boolean> {
  if (paidColumn.get(db)) return true;
  const rows = await db.values(sql`SELECT 1 FROM pragma_table_info('card_installments') WHERE name = 'paid_so_far'`);
  if (rows.length > 0) paidColumn.set(db, true);
  return rows.length > 0;
}

/**
 * The card's own opening balance: its earliest posted line against Opening Balances that the owner gave, not a
 * before-the-app settlement nor a plan's owed line. Null when it has none.
 */
export async function cardOpeningOfTx(db: Db, ws: WorkspaceContext, cardAccountId: string): Promise<{ id: string; occurredOn: string } | null> {
  const [row] = await db.values<[string, string]>(sql`
    SELECT t.id, t.occurred_on FROM transactions t
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted'
      AND EXISTS (SELECT 1 FROM entries e WHERE e.transaction_id = t.id AND e.account_id = ${cardAccountId})
      AND EXISTS (SELECT 1 FROM entries o JOIN accounts oa ON oa.id = o.account_id
                  WHERE o.transaction_id = t.id AND oa.kind = 'equity' AND oa.system_key = 'opening_balance')
      AND (t.external_ref IS NULL OR NOT ${balanceLineRef})
    ORDER BY t.occurred_on, t.created_at LIMIT 1`);
  return row ? { id: row[0], occurredOn: row[1] } : null;
}

/** Whether the card has an opening balance of its own (`cardOpeningOfTx`): then its plans post no owed line. */
export async function cardHasOpening(database: Database, ws: WorkspaceContext, cardAccountId: string): Promise<boolean> {
  return (await cardOpeningOfTx(database.db, ws, cardAccountId)) !== null;
}

/** The card's statement and due days: the statement day the 1st when none was set, as the statements read it. */
async function cardDaysTx(db: Db, cardAccountId: string): Promise<{ statementDay: number; dueDay: number | null }> {
  const [terms] = await db.values<[number | null, number | null]>(sql`SELECT statement_day, due_day FROM card_terms WHERE account_id = ${cardAccountId}`);
  return { statementDay: Number(terms?.[0] ?? 1), dueDay: terms?.[1] == null ? null : Number(terms[1]) };
}

/** What a plan with no purchase reads as paid when added on `addedOn`: every instalment whose payment was due before. */
export async function paidSoFarWhenAddedTx(db: Db, cardAccountId: string, plan: CardInstallment, addedOn: string): Promise<number> {
  const { statementDay, dueDay } = await cardDaysTx(db, cardAccountId);
  return paidSoFarOn(plan, statementDay, dueDay, addedOn);
}

/** "ORI030 · instalments 21–24 owed": the owed line's description. */
const owedDescription = (description: string, paidSoFar: number, months: number) =>
  paidSoFar + 1 === months ? `${description} · instalment ${months} owed` : `${description} · instalments ${paidSoFar + 1}–${months} owed`;

/**
 * Brings one plan's owed line in step with the plan: posted when the plan has no purchase, its card no opening balance of
 * its own and something left to pay; changed when what is owed changed; voided when the plan is gone, tied to a purchase,
 * or paid. Nothing is written when it already stands as it should.
 */
export async function refreshPlanOwedTx(tx: Db, given: WorkspaceContext, planId: string): Promise<void> {
  const ws = ownerScope(given);
  const ref = planOwedRef(planId);
  const had = await tx.values<[string, string, string, number]>(sql`
    SELECT t.id, t.occurred_on, t.description, e.amount_minor FROM transactions t
    JOIN entries e ON e.transaction_id = t.id JOIN accounts a ON a.id = e.account_id AND a.kind = 'liability'
    WHERE t.workspace_id = ${ws.workspaceId} AND t.status = 'posted' AND t.external_ref = ${ref}
    ORDER BY t.created_at`);
  const wanted = await wantedOwedTx(tx, ws, planId);
  if (wanted && had.length === 1) {
    const [, occurredOn, description, amountMinor] = had[0]!;
    if (occurredOn === wanted.occurredOn && description === wanted.description && -Number(amountMinor) === wanted.amountMinor) return;
  }
  if (!wanted && had.length === 0) return;
  for (const [id] of had) await voidTransactionTx(tx, ws, id);
  if (!wanted) return;
  await postTransactionTx(tx, ws, {
    occurredOn: wanted.occurredOn,
    description: wanted.description,
    lines: openingBalanceLines({
      accountId: wanted.cardAccountId,
      kind: 'liability',
      balanceMinor: wanted.amountMinor,
      currency: wanted.currency,
      equityAccountId: await systemAccountId(tx, ws, 'opening_balance'),
    }),
    ratesToBase: wanted.rate ? { [wanted.currency]: wanted.rate } : {},
    externalRef: ref,
  });
}

interface WantedOwed {
  cardAccountId: string;
  occurredOn: string;
  description: string;
  amountMinor: number;
  currency: string;
  rate: number | null;
}

async function wantedOwedTx(tx: Db, ws: WorkspaceContext, planId: string): Promise<WantedOwed | null> {
  if (!(await paidSoFarColumnExists(tx))) return null;
  const [plan] = await tx.values<[string, string | null, string, number, number, number, number, string]>(sql`
    SELECT card_account_id, transaction_id, description, total_minor, months, monthly_minor, paid_so_far, created_at
    FROM card_installments WHERE id = ${planId} AND workspace_id = ${ws.workspaceId}`);
  if (!plan) return null;
  const [cardAccountId, transactionId, description, totalMinor, months, monthlyMinor, paidSoFar, createdAt] = plan;
  if (transactionId !== null) return null;
  if (await cardOpeningOfTx(tx, ws, cardAccountId)) return null;
  const paid = clampPaidSoFar(Number(paidSoFar), Number(months));
  const amountMinor = owedAfter({ totalMinor: Number(totalMinor), months: Number(months), monthlyMinor: Number(monthlyMinor), firstBilledMonth: '', rateBps: 0, conversionFeeMinor: 0, earnsPoints: false }, paid);
  if (amountMinor <= 0) return null;
  const [card] = await tx.values<[string | null]>(sql`SELECT currency FROM accounts WHERE id = ${cardAccountId}`);
  const currency = card?.[0] ?? ws.baseCurrency;
  let rate: number | null = null;
  if (currency !== ws.baseCurrency) {
    // A card in another currency: at the rate its own lines were last posted at. With none, nothing can be posted.
    const [last] = await tx.values<[number | null]>(sql`
      SELECT e.fx_rate_to_base FROM entries e JOIN transactions t ON t.id = e.transaction_id
      WHERE e.account_id = ${cardAccountId} AND t.status = 'posted' ORDER BY t.occurred_on DESC, e.rowid DESC LIMIT 1`);
    rate = last?.[0] ? Number(last[0]) : null;
    if (!rate) return null;
  }
  return { cardAccountId, occurredOn: addedOnOf(createdAt), description: owedDescription(description, paid, Number(months)), amountMinor, currency, rate };
}

/**
 * Sets how many of a plan's instalments are paid: ticking or unticking its list, or an instalment row on the card's
 * statement. Its owed line and the row another phone counts it from follow. Only a plan with no purchase keeps it.
 */
export async function setPlanPaidSoFar(database: Database, given: WorkspaceContext, planId: string, paidSoFar: number): Promise<void> {
  const ws = ownerScope(given);
  await database.transaction(async (tx) => {
    const [plan] = await tx.values<[string | null, number]>(sql`SELECT transaction_id, months FROM card_installments WHERE id = ${planId} AND workspace_id = ${ws.workspaceId}`);
    if (!plan) throw new PlanPaidError('Plan not found in this workspace');
    if (plan[0] !== null) throw new PlanPaidError('A plan tied to a purchase is paid by the card’s payments');
    if (!Number.isInteger(paidSoFar) || paidSoFar < 0 || paidSoFar > Number(plan[1])) throw new PlanPaidError('Paid so far is from none to all of its months');
    await tx.run(sql`UPDATE card_installments SET paid_so_far = ${paidSoFar} WHERE id = ${planId} AND workspace_id = ${ws.workspaceId}`);
    await refreshPlanOwedTx(tx, given, planId);
    await refreshPlanSpreadTx(tx, given, planId);
  });
}

export class PlanPaidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanPaidError';
  }
}

/** The device-local key the repair is remembered by, per workspace. */
export const planPaidSoFarKey = (workspaceId: string) => `plan-paid-so-far.v1.${workspaceId}`;

/**
 * The plans with no purchase saved before 0124 (owner, 17 Nov 2026): once per workspace on this device, each is set to
 * what was paid on the day it was added — every instalment whose payment was due before then — and its owed line is
 * posted. Never worked out again: from then on only ticking changes it. Plans saved since 0124 were set when saved and
 * are left alone. Null when it has run already (or the database is too old for it).
 */
export async function repairPlanPaidSoFar(database: Database, given: WorkspaceContext): Promise<{ set: number } | null> {
  const ws = ownerScope(given);
  if (!(await paidSoFarColumnExists(database.db))) return null;
  const key = planPaidSoFarKey(ws.workspaceId);
  const [done] = await database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${key}`);
  if (done) return null;
  const [applied] = await database.db.values<[string]>(sql`SELECT applied_at FROM schema_migrations WHERE version = 124`);
  const before = applied?.[0] ?? new Date().toISOString();
  const plans = await database.db.values<[string, string, number, number, number, string, string]>(sql`
    SELECT id, card_account_id, total_minor, months, monthly_minor, first_billed_month, created_at FROM card_installments
    WHERE workspace_id = ${ws.workspaceId} AND transaction_id IS NULL AND created_at < ${before}`);
  let set = 0;
  for (const [id, cardAccountId, totalMinor, months, monthlyMinor, firstBilledMonth, createdAt] of plans) {
    await database.transaction(async (tx) => {
      const plan: CardInstallment = { totalMinor: Number(totalMinor), months: Number(months), monthlyMinor: Number(monthlyMinor), firstBilledMonth, rateBps: 0, conversionFeeMinor: 0, earnsPoints: false };
      const paid = await paidSoFarWhenAddedTx(tx, cardAccountId, plan, addedOnOf(createdAt));
      await tx.run(sql`UPDATE card_installments SET paid_so_far = ${paid} WHERE id = ${id}`);
      await refreshPlanOwedTx(tx, given, id);
      await refreshPlanSpreadTx(tx, given, id);
    });
    set += 1;
  }
  await database.db.run(sql`INSERT INTO settings (key, value) VALUES (${key}, ${JSON.stringify({ set })}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`);
  return { set };
}
