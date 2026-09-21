import { inflowTo, type MoneyLine, movedAmount, outflowFrom, uuidv7 } from '@expanses/core';
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { accounts } from '../schema';
import { assetProfiles } from '../schema-assets';
import { goalDraws, goalEarmarks, goalStages, goals } from '../schema-goals';
import { SPENDABLE_SUBTYPES } from './accounts';
import { recordContributionTx } from './goal-contributions';

/**
 * Whether migration 0050 has run on this database. Every read and write of goal_draws asks first, so a database stopped
 * at an older version behaves exactly as it does today: no answer is written, nothing is reversed, no draw is read. A
 * positive answer is remembered per handle; a negative one is not, since migrate() may run later on the same handle.
 */
const drawTables = new WeakMap<Db, boolean>();

export async function setAsideTablesExist(db: Db): Promise<boolean> {
  if (drawTables.get(db)) return true;
  const rows = await db.values<[number]>(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'goal_draws'`);
  const exists = rows.length > 0;
  if (exists) drawTables.set(db, true);
  return exists;
}

export class SetAsideError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetAsideError';
  }
}

export type SetAsideIntent = 'borrow' | 'spend' | 'move';

/** The answer to "which goal did this come from, and is this what the goal is for?", as a posting carries it. */
export interface SetAsideChoice {
  /** The account the money left. */
  accountId: string;
  /** The goal whose promise on that account it came out of. */
  goalId: string;
  intent: SetAsideIntent;
  /** What went over the free money, in the account's own currency: the most a borrow or a move takes. A spend ignores it. */
  overMinor: number;
  /** A move only: the account the promise follows the money to. */
  toAccountId?: string | null;
  /** A borrow only: whether the goal stood whole just before, and since when (null when not known). */
  wasWhole?: boolean;
  wholeSince?: string | null;
}

/** Money can wait for a goal wherever it can be set aside, or in a holding the owner groups as investments. */
export function isSetAsideHolder(subtype: string, planGroup: string | null): boolean {
  return (SPENDABLE_SUBTYPES as readonly string[]).includes(subtype) || planGroup === 'invest';
}

export async function canHoldSetAside(tx: Db, ws: WorkspaceContext, accountId: string): Promise<boolean> {
  const [account] = await tx
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return false;
  const [profile] = await tx
    .select({ planGroup: assetProfiles.planGroup })
    .from(assetProfiles)
    .where(and(eq(assetProfiles.accountId, accountId), eq(assetProfiles.workspaceId, ws.workspaceId)));
  return isSetAsideHolder(account.subtype, profile?.planGroup ?? null);
}

/**
 * Moves a goal's set-aside on one account by `deltaMinor`, never below zero, and returns what is left.
 * Used when money is parked for a goal and when a purchase spends it.
 */
export async function adjustSetAsideTx(tx: Db, ws: WorkspaceContext, goalId: string, accountId: string, deltaMinor: number): Promise<number> {
  const [existing] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  const next = Math.max(0, (existing?.amountMinor ?? 0) + deltaMinor);

  if (next === 0) {
    if (existing) {
      await tx
        .delete(goalEarmarks)
        .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    }
    return 0;
  }
  if (existing) {
    await tx
      .update(goalEarmarks)
      .set({ amountMinor: next })
      .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
    return next;
  }
  await tx.insert(goalEarmarks).values({ goalId, accountId, workspaceId: ws.workspaceId, amountMinor: next });
  return next;
}

/** Whether a carried answer still fits a replacement's lines: it still pays from the account, and a move still reaches its destination. */
export function carryable(choice: SetAsideChoice, lines: readonly MoneyLine[]): boolean {
  if (outflowFrom(lines, choice.accountId) <= 0) return false;
  return choice.intent !== 'move' || (!!choice.toAccountId && inflowTo(lines, choice.toAccountId) > 0);
}

/**
 * Whether a carried answer's goal still promises something on its account. An edit that does not mention the answer
 * must not be refused because the goal was archived or its set-aside removed since: the carried answer is dropped, as
 * it is when the edit pays from elsewhere. Read after the void, so a spend's promise is already given back.
 */
export async function stillPromisedTx(tx: Db, ws: WorkspaceContext, choice: SetAsideChoice): Promise<boolean> {
  const [goal] = await tx
    .select({ status: goals.status })
    .from(goals)
    .where(and(eq(goals.id, choice.goalId), eq(goals.workspaceId, ws.workspaceId)));
  if (!goal || goal.status === 'archived') return false;
  const [earmark] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, choice.goalId), eq(goalEarmarks.accountId, choice.accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  return !!earmark;
}

/**
 * Applies an answer inside the posting's own database transaction, from the entries as planned (each in its account's
 * currency). Refuses rather than guesses: a refusal here rolls the whole posting back.
 */
export async function applySetAsideTx(
  tx: Db,
  ws: WorkspaceContext,
  transactionId: string,
  occurredOn: string,
  lines: readonly MoneyLine[],
  choice: SetAsideChoice,
): Promise<void> {
  const outflow = outflowFrom(lines, choice.accountId);
  if (outflow <= 0) throw new SetAsideError('That goal\'s money is not in the account this pays from');
  if (!Number.isSafeInteger(choice.overMinor) || choice.overMinor <= 0) throw new SetAsideError('Say how much came out of the goal');
  const [goal] = await tx
    .select({ status: goals.status, kind: goals.kind })
    .from(goals)
    .where(and(eq(goals.id, choice.goalId), eq(goals.workspaceId, ws.workspaceId)));
  if (!goal || goal.status === 'archived') throw new SetAsideError('That is not a goal in this workspace');
  const [earmark] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, choice.goalId), eq(goalEarmarks.accountId, choice.accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  if (!earmark) throw new SetAsideError('Nothing is set aside for that goal in this account');

  const row = {
    id: uuidv7(),
    workspaceId: ws.workspaceId,
    transactionId,
    goalId: choice.goalId,
    accountId: choice.accountId,
    toAccountId: null as string | null,
    toAmountMinor: null as number | null,
    stageId: null as string | null,
    wasWhole: 0,
    wholeSince: null as string | null,
    occurredOn,
    createdAt: new Date().toISOString(),
  };

  if (choice.intent === 'borrow') {
    const whole = choice.wasWhole === true;
    await tx.insert(goalDraws).values({ ...row, intent: 'borrow', amountMinor: Math.min(choice.overMinor, outflow), wasWhole: whole ? 1 : 0, wholeSince: whole ? (choice.wholeSince ?? null) : null });
    return;
  }

  if (choice.intent === 'spend') {
    // "This is what I saved for": the whole payment comes out of the goal, up to what it promised (spec §11.2).
    const amount = Math.min(outflow, earmark.amountMinor);
    await adjustSetAsideTx(tx, ws, choice.goalId, choice.accountId, -amount);
    // An emergency fund is a standing level, not a finish line (ledger Ruling Q3): spending it on an emergency draws
    // it down and it reopens to be rebuilt, so no stage is ever marked paid for it. Every other goal pays its
    // earliest unpaid stage, and reads Done when every stage is paid.
    const [stage] =
      goal.kind === 'emergency'
        ? []
        : await tx
            .select({ id: goalStages.id })
            .from(goalStages)
            .where(and(eq(goalStages.goalId, choice.goalId), eq(goalStages.workspaceId, ws.workspaceId), isNull(goalStages.paidOn)))
            .orderBy(asc(goalStages.dueOn), asc(goalStages.sort))
            .limit(1);
    if (stage) await tx.update(goalStages).set({ paidOn: occurredOn }).where(eq(goalStages.id, stage.id));
    await tx.insert(goalDraws).values({ ...row, intent: 'spend', amountMinor: amount, stageId: stage?.id ?? null });
    return;
  }

  const toAccountId = choice.toAccountId ?? '';
  const inflow = toAccountId ? inflowTo(lines, toAccountId) : 0;
  if (inflow <= 0) throw new SetAsideError('A promise can only follow the money to where it went');
  if (!(await canHoldSetAside(tx, ws, toAccountId))) throw new SetAsideError('That account cannot hold money set aside');
  const moved = Math.min(choice.overMinor, outflow, earmark.amountMinor);
  const landed = movedAmount(moved, outflow, inflow);
  await adjustSetAsideTx(tx, ws, choice.goalId, choice.accountId, -moved);
  if (landed > 0) await adjustSetAsideTx(tx, ws, choice.goalId, toAccountId, landed);
  await tx.insert(goalDraws).values({ ...row, intent: 'move', amountMinor: moved, toAccountId, toAmountMinor: landed });
}

/** Reverses what a transaction's answers did to promises and stages, then forgets them. Called by every void. */
export async function undoSetAsideTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<void> {
  const rows = await tx
    .select()
    .from(goalDraws)
    .where(and(eq(goalDraws.transactionId, transactionId), eq(goalDraws.workspaceId, ws.workspaceId)));
  for (const draw of rows) {
    if (draw.intent === 'spend') {
      await adjustSetAsideTx(tx, ws, draw.goalId, draw.accountId, draw.amountMinor);
      // Only a stage still carrying this draw's date: one the owner re-dated by hand is theirs.
      if (draw.stageId) {
        await tx
          .update(goalStages)
          .set({ paidOn: null })
          .where(and(eq(goalStages.id, draw.stageId), eq(goalStages.workspaceId, ws.workspaceId), eq(goalStages.paidOn, draw.occurredOn)));
      }
    }
    if (draw.intent === 'move') {
      if (draw.toAccountId && draw.toAmountMinor) await adjustSetAsideTx(tx, ws, draw.goalId, draw.toAccountId, -draw.toAmountMinor);
      await adjustSetAsideTx(tx, ws, draw.goalId, draw.accountId, draw.amountMinor);
      // A goal's own money moved by a tagged transfer logged the move as a contribution; taking it back logs the reverse.
      if (draw.toAccountId === null) await recordContributionTx(tx, ws, draw.goalId, draw.accountId, draw.amountMinor, draw.occurredOn);
    }
  }
  if (rows.length > 0) await tx.delete(goalDraws).where(and(eq(goalDraws.transactionId, transactionId), eq(goalDraws.workspaceId, ws.workspaceId)));
}

/**
 * The answer a transaction was saved with, as a posting would carry it again. A tagged transfer's own move (a move with
 * no destination) is not an answer the owner gave: it is skipped, so a tagged transfer that also borrowed reads its borrow.
 */
export async function setAsideChoiceOfTx(tx: Db, ws: WorkspaceContext, transactionId: string): Promise<SetAsideChoice | null> {
  const [draw] = await tx
    .select()
    .from(goalDraws)
    .where(
      and(
        eq(goalDraws.transactionId, transactionId),
        eq(goalDraws.workspaceId, ws.workspaceId),
        or(ne(goalDraws.intent, 'move'), isNotNull(goalDraws.toAccountId)),
      ),
    )
    .limit(1);
  if (!draw) return null;
  return {
    accountId: draw.accountId,
    goalId: draw.goalId,
    intent: draw.intent,
    overMinor: draw.amountMinor,
    toAccountId: draw.toAccountId,
    wasWhole: draw.wasWhole === 1,
    wholeSince: draw.wholeSince,
  };
}
