import { inflowTo, type MoneyLine, movedAmount, outflowFrom, uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { accounts, entries, transactions } from '../schema';
import { assetProfiles } from '../schema-assets';
import { goalDraws, goalEarmarks, goalStages, goals } from '../schema-goals';
import { MONEY_SUBTYPES } from './accounts';

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
  /**
   * A spend an edit carries: the stage the original paid (null when it paid none). Omitted on a fresh answer, which
   * pays the earliest unpaid stage. Carrying it keeps one payment on one stage — an edit never pays the next. Null
   * pays none: also what the second and later postings of one payment split across several (Pay several) carry, so
   * one payment pays one stage.
   */
  stageId?: string | null;
  /**
   * A spend an edit carries through a void and a fresh posting (a trade's edit): what it drew, and what left the account
   * then. The re-applied spend keeps that amount and takes only what the payment grew by, never more because the
   * promise grew since (ruling I2). Set by `withSavedStage` from the saved answer only, never from a form.
   */
  carried?: { drawnMinor: number; outflowMinor: number };
}

/** Money can wait for a goal wherever it can be set aside, or in a holding the owner groups as investments. */
export function isSetAsideHolder(subtype: string, planGroup: string | null): boolean {
  return (MONEY_SUBTYPES as readonly string[]).includes(subtype) || planGroup === 'invest';
}

/** Whether an account is a pocket parent: it holds no money of its own, only adds its pockets up (currency pockets). */
export async function isPocketParentTx(tx: Db, ws: WorkspaceContext, accountId: string): Promise<boolean> {
  const [child] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), eq(accounts.kind, 'asset'), eq(accounts.parentId, accountId)))
    .limit(1);
  return !!child;
}

export async function canHoldSetAside(tx: Db, ws: WorkspaceContext, accountId: string): Promise<boolean> {
  const [account] = await tx
    .select({ subtype: accounts.subtype })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.workspaceId, ws.workspaceId)));
  if (!account) return false;
  // A pocket parent holds nothing, so nothing can be promised on it: the promise belongs on one of its pockets (ruling I5).
  if (await isPocketParentTx(tx, ws, accountId)) return false;
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

/** Lowers a goal's promise on an account by up to `amountMinor`, and returns what it actually took: never below nought. */
export async function lowerSetAsideTx(tx: Db, ws: WorkspaceContext, goalId: string, accountId: string, amountMinor: number): Promise<number> {
  if (amountMinor <= 0) return 0;
  const [existing] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  const before = existing?.amountMinor ?? 0;
  const after = await adjustSetAsideTx(tx, ws, goalId, accountId, -amountMinor);
  return before - after;
}

/** What a tagged transfer's void took back off its destination: what landed, and what of it was still promised there. */
export interface ArrivalTakenBack {
  landedMinor: number;
  takenMinor: number;
}

/**
 * Takes back what a transfer tagged to a goal parked: what landed comes back out of the goal's set-aside there, as far
 * as it is still there — money spent from it since is not taken twice. Called by every void (`voidTransactionTx`), so a
 * delete or an edit from any door leaves the goal as it stood before the transfer; the source side is `undoSetAsideTx`'s,
 * which gives back only the share of the goal's own move that was still on the destination.
 */
export async function takeBackTaggedArrivalTx(tx: Db, ws: WorkspaceContext, transactionId: string, goalId: string): Promise<ArrivalTakenBack> {
  const [row] = await tx.select({ occurredOn: transactions.occurredOn }).from(transactions).where(eq(transactions.id, transactionId));
  const lines = await tx
    .select({ accountId: entries.accountId, amountMinor: entries.amountMinor })
    .from(entries)
    .where(and(eq(entries.transactionId, transactionId), eq(entries.workspaceId, ws.workspaceId)));
  const move = await taggedMoveOfTx(tx, ws, row?.occurredOn ?? '', lines);
  if (!move) {
    for (const line of lines) if (line.amountMinor > 0) await adjustSetAsideTx(tx, ws, goalId, line.accountId, -line.amountMinor);
    return { landedMinor: 0, takenMinor: 0 };
  }
  return { landedMinor: move.landedMinor, takenMinor: await lowerSetAsideTx(tx, ws, goalId, move.toAccountId, move.landedMinor) };
}

/** What a transfer tagged to a goal moved: in the source's currency, and what landed in the destination's. */
export interface TaggedMove {
  occurredOn: string;
  fromAccountId: string;
  toAccountId: string;
  amountMinor: number;
  landedMinor: number;
}

/**
 * Parks a posted transfer for a goal: tags the transaction, moves the goal's own promise off the source (spec §4.6) and
 * sets what landed aside on the destination. `recordTaggedTransfer` and an edit of a tagged transfer
 * (`replaceTransaction`) both call it, so an edited transfer leaves the goal exactly where a new one of that amount would.
 * Returns what the goal now has set aside on the destination (0 when it cannot hold a set-aside).
 */
export async function parkForGoalTx(tx: Db, ws: WorkspaceContext, transactionId: string, goalId: string, move: TaggedMove): Promise<number> {
  await tx.update(transactions).set({ goalId }).where(eq(transactions.id, transactionId));
  if (!(await canHoldSetAside(tx, ws, move.toAccountId))) return 0;
  // The goal's own promise on the source follows its money, so the goal does not count it in both places.
  const [own] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, goalId), eq(goalEarmarks.accountId, move.fromAccountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  const moved = Math.min(move.amountMinor, own?.amountMinor ?? 0);
  // Only where the draw that undoes it can be written: a database stopped at 49 parks exactly as it did before, the
  // source promise untouched, so a void cannot leave the goal with no promise anywhere.
  if (moved > 0 && (await setAsideTablesExist(tx))) {
    await adjustSetAsideTx(tx, ws, goalId, move.fromAccountId, -moved);
    // A move with no destination: the destination's own adjustment is taken back by voidTransactionTx. The draw is
    // also what the monthly figure reads the move from, valued in base as the arrival is (goalContributionEvents).
    await tx.insert(goalDraws).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      transactionId,
      goalId,
      accountId: move.fromAccountId,
      intent: 'move',
      amountMinor: moved,
      toAccountId: null,
      toAmountMinor: null,
      stageId: null,
      wasWhole: 0,
      wholeSince: null,
      occurredOn: move.occurredOn,
      createdAt: new Date().toISOString(),
    });
  }
  // The set-aside sits on the destination account, so it is counted in the destination account's own money —
  // parking US$100 against a goal sets US$100 aside, never Rp 1.600.000 of a USD balance.
  return adjustSetAsideTx(tx, ws, goalId, move.toAccountId, move.landedMinor);
}

/**
 * The tagged move an edit's lines still make, or null when the edit is no longer a transfer between two of your own
 * accounts (it spends, earns, or splits): then the tag has nothing left to follow. The exchange account's legs are not
 * yours and are skipped.
 */
export async function taggedMoveOfTx(tx: Db, ws: WorkspaceContext, occurredOn: string, lines: readonly MoneyLine[]): Promise<TaggedMove | null> {
  const ids = [...new Set(lines.map((line) => line.accountId))];
  if (ids.length === 0) return null;
  const rows = await tx
    .select({ id: accounts.id, kind: accounts.kind, systemKey: accounts.systemKey })
    .from(accounts)
    .where(and(eq(accounts.workspaceId, ws.workspaceId), inArray(accounts.id, ids)));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const own = lines.filter((line) => byId.get(line.accountId)?.systemKey == null);
  if (own.some((line) => { const kind = byId.get(line.accountId)?.kind; return kind !== 'asset' && kind !== 'liability'; })) return null;
  const out = own.filter((line) => line.amountMinor < 0);
  const into = own.filter((line) => line.amountMinor > 0);
  if (out.length !== 1 || into.length !== 1 || out[0]!.accountId === into[0]!.accountId) return null;
  return { occurredOn, fromAccountId: out[0]!.accountId, toAccountId: into[0]!.accountId, amountMinor: -out[0]!.amountMinor, landedMinor: into[0]!.amountMinor };
}

/**
 * The answer an edit posts, with the stage its original spend paid: a spend from the same goal (carried, or given again
 * by an edit form, from the same account or — the payment moved — another) stays on that stage, and any other answer
 * picks afresh. One payment pays one stage. `saved` is the original's answer, read before the void.
 */
export function withSavedStage(answered: SetAsideChoice | null, saved: SetAsideChoice | null): SetAsideChoice | null {
  if (!answered) return null;
  const { stageId: _ignored, carried: _alsoIgnored, ...fresh } = answered;
  // From the same account it is the same draw: a spend keeps what it drew (ruling I2), and a borrow stays a borrow even
  // when the goal's promise there was spent to nought since (M1). Moved to another account it draws afresh.
  const carried = saved && answered.accountId === saved.accountId && answered.goalId === saved.goalId && answered.intent === saved.intent && saved.carried ? { carried: saved.carried } : {};
  if (answered.intent === 'borrow') return { ...fresh, ...carried };
  const same = answered.intent === 'spend' && saved?.intent === 'spend' && answered.goalId === saved.goalId;
  if (!same) return fresh;
  return { ...fresh, stageId: saved.stageId ?? null, ...carried };
}

/** Whether an edit's answer is the saved one: the same goal, the same account, the same intent and destination. */
export function sameAnswer(answered: SetAsideChoice, saved: SetAsideChoice): boolean {
  return (
    answered.intent === saved.intent &&
    answered.goalId === saved.goalId &&
    answered.accountId === saved.accountId &&
    (answered.intent !== 'move' || (answered.toAccountId ?? null) === (saved.toAccountId ?? null))
  );
}

/** Whether a goal is still one the workspace plans for: an archived goal is history and takes no answer. */
export async function goalActiveTx(tx: Db, ws: WorkspaceContext, goalId: string): Promise<boolean> {
  const [goal] = await tx.select({ status: goals.status }).from(goals).where(and(eq(goals.id, goalId), eq(goals.workspaceId, ws.workspaceId)));
  return !!goal && goal.status !== 'archived';
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
  // A borrow promises nothing itself: it is kept while its goal is active, spent-to-nought promise or not (M1).
  if (choice.intent === 'borrow') return true;
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
  // A borrow an edit carries stands even when the promise was spent to nought since: it records a debt, not a promise.
  if (!earmark && !(choice.intent === 'borrow' && choice.carried)) throw new SetAsideError('Nothing is set aside for that goal in this account');

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
    // "This is what I saved for": the whole payment comes out of the goal, up to what it promised (spec §11.2). A spend an
    // edit carries keeps what it drew, plus only what the payment grew by (ruling I2).
    const carriedCap = choice.carried ? choice.carried.drawnMinor + Math.max(0, outflow - choice.carried.outflowMinor) : outflow;
    const amount = Math.min(outflow, earmark!.amountMinor, carriedCap);
    await adjustSetAsideTx(tx, ws, choice.goalId, choice.accountId, -amount);
    // An emergency fund is a standing level, not a finish line (ledger Ruling Q3): spending it on an emergency draws
    // it down and it reopens to be rebuilt, so no stage is ever marked paid for it. Every other goal pays its
    // earliest unpaid stage, and reads Done when every stage is paid.
    // An edit carries the stage its original paid: it is re-marked when the void un-paid it, and left as it is when the
    // owner dated it by hand. Picking afresh would pay the next stage with the same money.
    const [stage] =
      choice.stageId !== undefined
        ? choice.stageId === null
          ? []
          : await tx
              .select({ id: goalStages.id, paidOn: goalStages.paidOn })
              .from(goalStages)
              .where(and(eq(goalStages.id, choice.stageId), eq(goalStages.goalId, choice.goalId), eq(goalStages.workspaceId, ws.workspaceId)))
        : goal.kind === 'emergency'
          ? []
          : await tx
              .select({ id: goalStages.id, paidOn: goalStages.paidOn })
              .from(goalStages)
              .where(and(eq(goalStages.goalId, choice.goalId), eq(goalStages.workspaceId, ws.workspaceId), isNull(goalStages.paidOn)))
              .orderBy(asc(goalStages.dueOn), asc(goalStages.sort))
              .limit(1);
    if (stage && stage.paidOn === null) await tx.update(goalStages).set({ paidOn: occurredOn }).where(eq(goalStages.id, stage.id));
    await tx.insert(goalDraws).values({ ...row, intent: 'spend', amountMinor: amount, stageId: stage?.id ?? null });
    return;
  }

  const toAccountId = choice.toAccountId ?? '';
  const inflow = toAccountId ? inflowTo(lines, toAccountId) : 0;
  if (inflow <= 0) throw new SetAsideError('A promise can only follow the money to where it went');
  if (!(await canHoldSetAside(tx, ws, toAccountId))) throw new SetAsideError('That account cannot hold money set aside');
  const moved = Math.min(choice.overMinor, outflow, earmark!.amountMinor);
  const landed = movedAmount(moved, outflow, inflow);
  await adjustSetAsideTx(tx, ws, choice.goalId, choice.accountId, -moved);
  if (landed > 0) await adjustSetAsideTx(tx, ws, choice.goalId, toAccountId, landed);
  await tx.insert(goalDraws).values({ ...row, intent: 'move', amountMinor: moved, toAccountId, toAmountMinor: landed });
}

/** What a void keeps: an edit that carries a draw re-points it to the replacement instead of undoing it (ruling I1). */
export interface VoidKeep {
  /** The owner's answer (a borrow, a spend, or a move with a destination). */
  answer?: boolean;
  /** A tagged transfer's arrival and its own move (a move with no destination). */
  tagged?: boolean;
}

/** An answer's draw rather than a tagged transfer's own move or a buy's lowering (a move with no destination). */
const isAnswer = (draw: { intent: SetAsideIntent; toAccountId: string | null }) => draw.intent !== 'move' || draw.toAccountId !== null;

/** Un-pays the stage a spend paid, when it still carries the spend's date and the goal is not archived (history). */
async function unpayStageTx(tx: Db, ws: WorkspaceContext, draw: { goalId: string; stageId: string | null; occurredOn: string }): Promise<void> {
  if (!draw.stageId) return;
  // Only a stage still carrying this draw's date: one the owner re-dated by hand is theirs. And never on an archived
  // goal: it is history, and the edit that re-files the payment which completed it drops the answer (it promises
  // nothing now), so un-paying here would leave the archive reading not done for a payment that still stands.
  if (!(await goalActiveTx(tx, ws, draw.goalId))) return;
  await tx
    .update(goalStages)
    .set({ paidOn: null })
    .where(and(eq(goalStages.id, draw.stageId), eq(goalStages.workspaceId, ws.workspaceId), eq(goalStages.paidOn, draw.occurredOn)));
}

/**
 * Reverses what a transaction's answers did to promises and stages, then forgets them. Called by every void.
 *
 * An undo gives back only what is still there (ruling I1): a move takes its landed promise back off the destination as
 * far as it is still promised there, and gives the source back the same share of what it took. A tagged transfer's own
 * move does the same against its arrival (`arrival`, from `takeBackTaggedArrivalTx`). Money spent from the destination
 * since is not given back a second time, whatever order things are deleted in. A buy's lowering has no destination and
 * is given back whole.
 */
export async function undoSetAsideTx(tx: Db, ws: WorkspaceContext, transactionId: string, arrival: ArrivalTakenBack | null = null, keep: VoidKeep = {}): Promise<void> {
  const rows = await tx
    .select()
    .from(goalDraws)
    .where(and(eq(goalDraws.transactionId, transactionId), eq(goalDraws.workspaceId, ws.workspaceId)));
  const undone = rows.filter((draw) => (isAnswer(draw) ? !keep.answer : !keep.tagged));
  for (const draw of undone) {
    if (draw.intent === 'spend') {
      await adjustSetAsideTx(tx, ws, draw.goalId, draw.accountId, draw.amountMinor);
      await unpayStageTx(tx, ws, draw);
    }
    if (draw.intent === 'move') {
      let giveBack = draw.amountMinor;
      if (draw.toAccountId) {
        const landed = draw.toAmountMinor ?? 0;
        const taken = await lowerSetAsideTx(tx, ws, draw.goalId, draw.toAccountId, landed);
        if (landed > 0 && taken < landed) giveBack = movedAmount(draw.amountMinor, landed, taken);
      } else if (arrival && arrival.landedMinor > 0 && arrival.takenMinor < arrival.landedMinor) {
        giveBack = movedAmount(draw.amountMinor, arrival.landedMinor, arrival.takenMinor);
      }
      if (giveBack > 0) await adjustSetAsideTx(tx, ws, draw.goalId, draw.accountId, giveBack);
    }
  }
  if (undone.length > 0) await tx.delete(goalDraws).where(inArray(goalDraws.id, undone.map((draw) => draw.id)));
}

/**
 * A later draw that spent or moved promise an edit now takes back: when an edit lowers what landed on an account and the
 * goal's promise there was already spent from, the draws that spent it are cut — newest first — by what could not be
 * taken, as if the smaller figure had been posted in the first place. A spend drew less; a move carried less on, and its
 * own destination gives the difference back the same way. Returns how much was absorbed (at most `amountMinor`).
 */
async function absorbLaterDrawsTx(tx: Db, ws: WorkspaceContext, goalId: string, accountId: string, amountMinor: number, exclude: readonly string[]): Promise<number> {
  const rows = await tx
    .select({ draw: goalDraws })
    .from(goalDraws)
    .innerJoin(transactions, eq(transactions.id, goalDraws.transactionId))
    .where(
      and(
        eq(goalDraws.workspaceId, ws.workspaceId),
        eq(goalDraws.goalId, goalId),
        eq(goalDraws.accountId, accountId),
        inArray(goalDraws.intent, ['spend', 'move']),
        eq(transactions.status, 'posted'),
        exclude.length ? notInArray(goalDraws.transactionId, [...exclude]) : sql`1 = 1`,
      ),
    )
    .orderBy(sql`${goalDraws}.rowid desc`);
  let absorbed = 0;
  for (const { draw } of rows) {
    const need = amountMinor - absorbed;
    if (need <= 0) break;
    let cut = Math.min(need, draw.amountMinor);
    let toAmountMinor = draw.toAmountMinor;
    if (draw.intent === 'move' && draw.toAccountId && (draw.toAmountMinor ?? 0) > 0) {
      const landed = draw.toAmountMinor!;
      const lessLanded = landed - movedAmount(draw.amountMinor - cut, draw.amountMinor, landed);
      const taken = await lowerSetAsideTx(tx, ws, goalId, draw.toAccountId, lessLanded);
      const resolved = taken + (taken < lessLanded ? await absorbLaterDrawsTx(tx, ws, goalId, draw.toAccountId, lessLanded - taken, exclude) : 0);
      if (resolved < lessLanded) cut = movedAmount(cut, lessLanded, resolved);
      toAmountMinor = landed - resolved;
    }
    if (cut <= 0) continue;
    const left = draw.amountMinor - cut;
    if (left > 0) {
      await tx.update(goalDraws).set({ amountMinor: left, toAmountMinor }).where(eq(goalDraws.id, draw.id));
    } else {
      await tx.delete(goalDraws).where(eq(goalDraws.id, draw.id));
      if (draw.intent === 'spend') await unpayStageTx(tx, ws, draw);
    }
    absorbed += cut;
  }
  return absorbed;
}

/**
 * Carries a move's effect on two promises from what it did to what it now does, by the difference (ruling I1): the
 * destination is raised, or lowered as far as it is still there (and the later draws that spent it cut, see
 * `absorbLaterDrawsTx`); the source is lowered, or given back — only the share the destination actually returned.
 * Returns what the move now holds taken from the source and credited to the destination.
 */
async function shiftMoveTx(
  tx: Db,
  ws: WorkspaceContext,
  goalId: string,
  fromAccountId: string,
  toAccountId: string,
  was: { movedMinor: number; creditedMinor: number },
  next: { movedMinor: number; landedMinor: number },
  exclude: readonly string[],
  withDraws: boolean,
): Promise<{ movedMinor: number; creditedMinor: number }> {
  let credited = was.creditedMinor;
  let wanted = 0;
  let resolved = 0;
  const towardDestination = next.landedMinor - was.creditedMinor;
  if (towardDestination > 0) {
    await adjustSetAsideTx(tx, ws, goalId, toAccountId, towardDestination);
    credited += towardDestination;
  } else if (towardDestination < 0) {
    wanted = -towardDestination;
    const taken = await lowerSetAsideTx(tx, ws, goalId, toAccountId, wanted);
    resolved = taken + (taken < wanted && withDraws ? await absorbLaterDrawsTx(tx, ws, goalId, toAccountId, wanted - taken, exclude) : 0);
    credited -= resolved;
  }
  let moved = was.movedMinor;
  const offSource = next.movedMinor - was.movedMinor;
  if (offSource > 0) moved += await lowerSetAsideTx(tx, ws, goalId, fromAccountId, offSource);
  if (offSource < 0) {
    const giveBack = wanted > 0 && resolved < wanted ? movedAmount(-offSource, wanted, resolved) : -offSource;
    if (giveBack > 0) await adjustSetAsideTx(tx, ws, goalId, fromAccountId, giveBack);
    moved -= giveBack;
  }
  return { movedMinor: moved, creditedMinor: credited };
}

type Line = { accountId: string; amountMinor: number };

/**
 * Carries the saved answer onto an edit by the difference, never by undoing and redoing it (rulings I1, I2): the draw is
 * re-pointed to the replacement, keeps its stage (re-dated with the edit when it still carries the old date), and
 * - a borrow keeps its amount, clamped to what the edit now pays;
 * - a spend keeps what it drew and takes only what the payment grew by, as far as the promise allows;
 * - a move is re-worked only when what left or landed changed, then shifted by the difference.
 * `explicit` is the answer an edit form gave again (the same goal, account and intent): its `overMinor` is the cap a
 * changed borrow or move is worked out against; a carried answer's cap is what the draw already took.
 */
export async function carryAnswerTx(
  tx: Db,
  ws: WorkspaceContext,
  fromTransactionId: string,
  toTransactionId: string,
  occurredOn: string,
  oldLines: readonly Line[],
  newLines: readonly Line[],
  explicit: SetAsideChoice | null,
): Promise<void> {
  const [draw] = (
    await tx
      .select()
      .from(goalDraws)
      .where(and(eq(goalDraws.transactionId, fromTransactionId), eq(goalDraws.workspaceId, ws.workspaceId)))
  ).filter(isAnswer);
  if (!draw) return;
  await tx.update(goalDraws).set({ transactionId: toTransactionId, occurredOn }).where(eq(goalDraws.id, draw.id));
  if (draw.stageId && occurredOn !== draw.occurredOn) {
    await tx
      .update(goalStages)
      .set({ paidOn: occurredOn })
      .where(and(eq(goalStages.id, draw.stageId), eq(goalStages.workspaceId, ws.workspaceId), eq(goalStages.paidOn, draw.occurredOn)));
  }
  const oldOut = outflowFrom(oldLines, draw.accountId);
  const newOut = outflowFrom(newLines, draw.accountId);
  const cap = explicit ? explicit.overMinor : draw.amountMinor;

  if (draw.intent === 'borrow') {
    const amount = oldOut === newOut ? draw.amountMinor : Math.min(cap, newOut);
    if (amount !== draw.amountMinor) await tx.update(goalDraws).set({ amountMinor: amount }).where(eq(goalDraws.id, draw.id));
    return;
  }
  const [earmark] = await tx
    .select({ amountMinor: goalEarmarks.amountMinor })
    .from(goalEarmarks)
    .where(and(eq(goalEarmarks.goalId, draw.goalId), eq(goalEarmarks.accountId, draw.accountId), eq(goalEarmarks.workspaceId, ws.workspaceId)));
  const promise = earmark?.amountMinor ?? 0;

  if (draw.intent === 'spend') {
    const amount = Math.min(newOut, draw.amountMinor + Math.max(0, newOut - oldOut), draw.amountMinor + promise);
    if (amount > draw.amountMinor) await adjustSetAsideTx(tx, ws, draw.goalId, draw.accountId, -(amount - draw.amountMinor));
    if (amount < draw.amountMinor) await adjustSetAsideTx(tx, ws, draw.goalId, draw.accountId, draw.amountMinor - amount);
    if (amount !== draw.amountMinor) await tx.update(goalDraws).set({ amountMinor: amount }).where(eq(goalDraws.id, draw.id));
    return;
  }

  const toAccountId = draw.toAccountId!;
  const oldIn = inflowTo(oldLines, toAccountId);
  const newIn = inflowTo(newLines, toAccountId);
  if (oldOut === newOut && oldIn === newIn) return;
  const movedMinor = Math.min(cap, newOut, draw.amountMinor + promise);
  const shifted = await shiftMoveTx(
    tx,
    ws,
    draw.goalId,
    draw.accountId,
    toAccountId,
    { movedMinor: draw.amountMinor, creditedMinor: draw.toAmountMinor ?? 0 },
    { movedMinor, landedMinor: movedAmount(movedMinor, newOut, newIn) },
    [fromTransactionId, toTransactionId],
    true,
  );
  if (shifted.movedMinor > 0) {
    await tx.update(goalDraws).set({ amountMinor: shifted.movedMinor, toAmountMinor: shifted.creditedMinor }).where(eq(goalDraws.id, draw.id));
  } else {
    await tx.delete(goalDraws).where(eq(goalDraws.id, draw.id));
  }
}

/**
 * Carries a tagged transfer onto an edit that still moves between the same two accounts, by the difference (ruling I1):
 * the destination's promise follows what landed, the goal's own move off the source follows what left — keeping what
 * it took and taking only what the transfer grew by — and nothing already spent from the destination is given back.
 * The replacement is tagged. A database stopped at 49 carries only the destination, as it parked only that.
 */
export async function carryTaggedTx(
  tx: Db,
  ws: WorkspaceContext,
  fromTransactionId: string,
  toTransactionId: string,
  goalId: string,
  was: TaggedMove,
  next: TaggedMove,
): Promise<void> {
  await tx.update(transactions).set({ goalId }).where(eq(transactions.id, toTransactionId));
  if (!(await canHoldSetAside(tx, ws, next.toAccountId))) return;
  const withDraws = await setAsideTablesExist(tx);
  const [own] = withDraws
    ? (
        await tx
          .select()
          .from(goalDraws)
          .where(and(eq(goalDraws.transactionId, fromTransactionId), eq(goalDraws.workspaceId, ws.workspaceId), eq(goalDraws.goalId, goalId)))
      ).filter((draw) => !isAnswer(draw))
    : [];
  const wasMoved = own?.amountMinor ?? 0;
  const nextMoved = withDraws ? Math.min(next.amountMinor, wasMoved + Math.max(0, next.amountMinor - was.amountMinor)) : 0;
  const shifted = await shiftMoveTx(
    tx,
    ws,
    goalId,
    next.fromAccountId,
    next.toAccountId,
    { movedMinor: wasMoved, creditedMinor: was.landedMinor },
    { movedMinor: nextMoved, landedMinor: next.landedMinor },
    [fromTransactionId, toTransactionId],
    withDraws,
  );
  if (!withDraws) return;
  if (own && shifted.movedMinor > 0) {
    await tx.update(goalDraws).set({ transactionId: toTransactionId, amountMinor: shifted.movedMinor, occurredOn: next.occurredOn }).where(eq(goalDraws.id, own.id));
  } else if (own) {
    await tx.delete(goalDraws).where(eq(goalDraws.id, own.id));
  } else if (shifted.movedMinor > 0) {
    await tx.insert(goalDraws).values({
      id: uuidv7(),
      workspaceId: ws.workspaceId,
      transactionId: toTransactionId,
      goalId,
      accountId: next.fromAccountId,
      intent: 'move',
      amountMinor: shifted.movedMinor,
      toAccountId: null,
      toAmountMinor: null,
      stageId: null,
      wasWhole: 0,
      wholeSince: null,
      occurredOn: next.occurredOn,
      createdAt: new Date().toISOString(),
    });
  }
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
  let carried: SetAsideChoice['carried'];
  if (draw.intent !== 'move') {
    const lines = await tx
      .select({ accountId: entries.accountId, amountMinor: entries.amountMinor })
      .from(entries)
      .where(and(eq(entries.transactionId, transactionId), eq(entries.workspaceId, ws.workspaceId)));
    carried = { drawnMinor: draw.amountMinor, outflowMinor: outflowFrom(lines, draw.accountId) };
  }
  return {
    accountId: draw.accountId,
    goalId: draw.goalId,
    intent: draw.intent,
    overMinor: draw.amountMinor,
    toAccountId: draw.toAccountId,
    wasWhole: draw.wasWhole === 1,
    wholeSince: draw.wholeSince,
    ...(draw.intent === 'spend' ? { stageId: draw.stageId } : {}),
    ...(carried ? { carried } : {}),
  };
}
