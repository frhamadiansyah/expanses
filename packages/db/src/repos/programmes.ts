import { type Balance, balanceOf, consumeFifo, cycleFor, type ExpiryPolicy, expiresOn as expiryDateFor, LedgerError, type TransferPartner, uuidv7 } from '@expanses/core';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Database, Db } from '../database';
import { accounts } from '../schema';
import { cardTerms, earnsInto, pointEntries, pointProgrammes, pointSnapshots, rewardPrograms } from '../schema-points';
import { backfillCycles, expireDueEntries, listPointEntries } from './point-ledger';
import { findProgramme, programmeIdOf, type ProgrammeRow } from './programme-link';
import { listTransferPartners, PointsError } from './points';

/*
 * Points programmes (0085): a balance of its own — a bank's programme, an airline's, a hotel's — that cards earn into
 * and that points convert between.
 *
 * A bank card earns into the bank's programme, whose points are later converted into a partner at that programme's
 * ratio; a co-brand card earns straight into the airline's or the hotel's. So an airline programme's balance is the
 * miles converted in, plus what any co-brand card earned, less what was spent — the figure the airline's own app
 * shows. The card keeps everything about earning (rules, caps, bonuses, statement checks); the programme holds the
 * balance, its expiry, what was redeemed and what was converted.
 */

export { type ProgrammeRow } from './programme-link';
export type ProgrammeUnit = ProgrammeRow['unit'];

const UNITS: readonly ProgrammeUnit[] = ['points', 'miles', 'cashback'];

/** A card earning into a programme: its reward program and the card account it belongs to. */
export interface ProgrammeEarner {
  programId: string;
  cardAccountId: string;
  cardName: string;
}

export interface ProgrammeInput {
  name: string;
  unit: ProgrammeUnit;
  expiryPolicy?: ExpiryPolicy;
  expiryMonths?: number | null;
}

async function requireProgramme(db: Db, ws: WorkspaceContext, programmeId: string): Promise<ProgrammeRow> {
  const programme = await findProgramme(db, ws, programmeId);
  if (!programme) throw new PointsError('Points programme not found');
  return programme;
}

function checkExpiry(policy: ExpiryPolicy, months: number | null): void {
  if (policy !== 'none' && policy !== 'months_from_earn' && policy !== 'fixed_annual') throw new PointsError('Unknown expiry policy');
  if (policy === 'months_from_earn' && (months === null || !Number.isInteger(months) || months <= 0)) throw new PointsError('Say how many months the points last');
}

/** Two programmes with one name would be one balance shown twice, and a conversion could land in the wrong one. */
async function refuseDuplicateName(db: Db, ws: WorkspaceContext, name: string, exceptId: string | null): Promise<void> {
  const live = await db
    .select({ id: pointProgrammes.id, name: pointProgrammes.name })
    .from(pointProgrammes)
    .where(and(eq(pointProgrammes.workspaceId, ws.workspaceId), isNull(pointProgrammes.archivedAt)));
  if (live.some((row) => row.id !== exceptId && row.name.trim().toLowerCase() === name.toLowerCase())) {
    throw new PointsError(`There is already a programme called ${name}`);
  }
}

export async function listProgrammes(database: Database, ws: WorkspaceContext, options: { withArchived?: boolean } = {}): Promise<ProgrammeRow[]> {
  return database.db
    .select()
    .from(pointProgrammes)
    .where(and(eq(pointProgrammes.workspaceId, ws.workspaceId), options.withArchived ? undefined : isNull(pointProgrammes.archivedAt)))
    .orderBy(asc(pointProgrammes.createdAt), asc(pointProgrammes.id));
}

export async function getProgramme(database: Database, ws: WorkspaceContext, programmeId: string): Promise<ProgrammeRow | undefined> {
  return findProgramme(database.db, ws, programmeId);
}

/** The cards earning into each programme, by programme id. A card whose rewards were put away earns into nothing. */
export async function programmeEarners(database: Database | { db: Db }, ws: WorkspaceContext): Promise<Map<string, ProgrammeEarner[]>> {
  const rows = await database.db
    .select({ programmeId: earnsInto.programmeId, programId: rewardPrograms.id, cardAccountId: rewardPrograms.cardAccountId, cardName: accounts.name })
    .from(earnsInto)
    .innerJoin(rewardPrograms, eq(rewardPrograms.id, earnsInto.programId))
    .innerJoin(accounts, eq(accounts.id, rewardPrograms.cardAccountId))
    .where(and(eq(earnsInto.workspaceId, ws.workspaceId), isNull(rewardPrograms.archivedAt)))
    .orderBy(asc(rewardPrograms.createdAt));
  const out = new Map<string, ProgrammeEarner[]>();
  for (const row of rows) {
    out.set(row.programmeId, [...(out.get(row.programmeId) ?? []), { programId: row.programId, cardAccountId: row.cardAccountId, cardName: row.cardName }]);
  }
  return out;
}

/** The programme a card's reward program earns into. */
export async function programmeOfCard(database: Database, ws: WorkspaceContext, programId: string): Promise<ProgrammeRow | undefined> {
  return findProgramme(database.db, ws, await programmeIdOf(database.db, ws, programId));
}

/**
 * Where a programme's points can be converted to, and at what ratio: the transfer partners of the cards earning into
 * it, each partner once (the first card's terms, when two cards list the same one).
 */
export async function programmePartners(database: Database, ws: WorkspaceContext, programmeId: string): Promise<TransferPartner[]> {
  const out: TransferPartner[] = [];
  for (const earner of (await programmeEarners(database, ws)).get(programmeId) ?? []) {
    for (const partner of await listTransferPartners(database, ws, earner.programId)) {
      if (!out.some((seen) => seen.program.trim().toLowerCase() === partner.program.trim().toLowerCase())) out.push(partner);
    }
  }
  return out;
}

/** A programme no card earns into yet: an airline's or a hotel's, filled by conversions or by a balance read. */
export async function createProgramme(database: Database, ws: WorkspaceContext, input: ProgrammeInput): Promise<ProgrammeRow> {
  return database.transaction((tx) => createProgrammeTx(tx, ws, input));
}

export async function createProgrammeTx(tx: Db, ws: WorkspaceContext, input: ProgrammeInput): Promise<ProgrammeRow> {
  const name = input.name.trim();
  if (!name) throw new PointsError('A programme needs a name');
  if (!UNITS.includes(input.unit)) throw new PointsError('Unknown unit');
  const policy = input.expiryPolicy ?? 'none';
  const months = policy === 'months_from_earn' ? (input.expiryMonths ?? null) : null;
  checkExpiry(policy, months);
  await refuseDuplicateName(tx, ws, name, null);
  const row: ProgrammeRow = { id: uuidv7(), workspaceId: ws.workspaceId, name, unit: input.unit, expiryPolicy: policy, expiryMonths: months, archivedAt: null, createdAt: new Date().toISOString() };
  await tx.insert(pointProgrammes).values(row);
  return row;
}

/** Its name and unit. How its points die is `setProgramExpiry`, which every batch is stamped from. */
export async function updateProgramme(database: Database, ws: WorkspaceContext, programmeId: string, input: { name: string; unit: ProgrammeUnit }): Promise<void> {
  const name = input.name.trim();
  if (!name) throw new PointsError('A programme needs a name');
  if (!UNITS.includes(input.unit)) throw new PointsError('Unknown unit');
  await database.transaction(async (tx) => {
    await requireProgramme(tx, ws, programmeId);
    await refuseDuplicateName(tx, ws, name, programmeId);
    await tx.update(pointProgrammes).set({ name, unit: input.unit }).where(and(eq(pointProgrammes.id, programmeId), eq(pointProgrammes.workspaceId, ws.workspaceId)));
  });
}

/**
 * Puts a programme away: out of the Cards page and out of every picker, with its ledger kept. A card still earning into
 * it would be earning into nothing visible, so that card has to be moved first.
 */
export async function archiveProgramme(database: Database, ws: WorkspaceContext, programmeId: string): Promise<void> {
  await database.transaction(async (tx) => {
    await requireProgramme(tx, ws, programmeId);
    if (((await programmeEarners({ db: tx }, ws)).get(programmeId) ?? []).length > 0) {
      throw new PointsError('A card still earns into this programme. Choose another programme for that card first.');
    }
    await tx.update(pointProgrammes).set({ archivedAt: new Date().toISOString() }).where(and(eq(pointProgrammes.id, programmeId), eq(pointProgrammes.workspaceId, ws.workspaceId)));
  });
}

/*
 * tier (0088) is read and written by name, as accounts.card_tier (0087) is: a database stopped before it has no such
 * column, and there no programme has a tier. Asked once per handle, and only a yes is kept.
 */
const tierColumn = new WeakMap<object, boolean>();
async function tierColumnExists(tx: Db): Promise<boolean> {
  if (tierColumn.get(tx)) return true;
  const rows = await tx.values<[number]>(sql`SELECT 1 FROM pragma_table_info('point_programmes') WHERE name = 'tier'`);
  if (rows.length > 0) tierColumn.set(tx, true);
  return rows.length > 0;
}

/**
 * A tier is the programme's short word for it: 'gold', 'ambassador' — letters alone. Which words a programme has is
 * the app's to know (its membership cards); a word it has no card for is kept and drawn as the programme's first tier.
 */
const TIER_WORD = /^[a-z]{2,24}$/;

/** Each programme's card tier (0088), by programme id: only the live programmes that have one are listed. */
export async function listProgrammeTiers(database: Database, ws: WorkspaceContext): Promise<Record<string, string>> {
  if (!(await tierColumnExists(database.db))) return {};
  const rows = await database.db.values<[string, string]>(
    sql`SELECT id, tier FROM point_programmes WHERE workspace_id = ${ws.workspaceId} AND tier IS NOT NULL AND archived_at IS NULL`,
  );
  return Object.fromEntries(rows);
}

/**
 * Which of its membership cards a programme is drawn as on the Points page (0088): the tier's short word, or null for
 * the programme's first. A word that is not a short lowercase word is refused, not stored.
 */
export async function setProgrammeTier(database: Database, ws: WorkspaceContext, programmeId: string, tier: string | null): Promise<void> {
  const word = tier?.trim() || null;
  if (word !== null && !TIER_WORD.test(word)) throw new PointsError('A card tier is a short word, like gold');
  await database.transaction(async (tx) => {
    await requireProgramme(tx, ws, programmeId);
    if (!(await tierColumnExists(tx))) throw new PointsError('This database cannot keep that yet');
    await tx.run(sql`UPDATE point_programmes SET tier = ${word} WHERE id = ${programmeId} AND workspace_id = ${ws.workspaceId}`);
  });
}

export interface EarnsIntoResult {
  /** The programme the card earned into before, or null when it was already this one. */
  previousId: string | null;
  /** Whether that programme was put away: nothing earns into it any more and it holds nothing. */
  previousArchived: boolean;
}

/**
 * Sets which programme a card earns into — how two cards of one bank are joined into the bank's single balance.
 *
 * What moves with the card:
 * - When the programme it leaves is the card's own — opened with the card (by 0085, or when its rewards were set up)
 *   and earned into by no other card — that programme was simply this card's copy of the balance, so its whole ledger
 *   (every entry and every balance read) moves into the chosen one. Two copies of one real balance become one, and
 *   the one left behind holds nothing.
 * - Otherwise only the points this card earned move. What was spent, read or converted there belongs to a balance
 *   that is not the card's alone: one other cards still earn into, or one that was its own programme before this card
 *   was set to earn into it (an airline's, holding miles converted in).
 *
 * Afterwards the programme left behind is put away when nothing earns into it and its balance is nothing; otherwise
 * it stays, because a balance that still holds points must stay in sight. A programme put away earlier comes back when
 * a card is set to earn into it again.
 */
export async function setEarnsInto(database: Database, ws: WorkspaceContext, programId: string, programmeId: string): Promise<EarnsIntoResult> {
  return database.transaction(async (tx) => {
    const [program] = await tx
      .select({ id: rewardPrograms.id })
      .from(rewardPrograms)
      .where(and(eq(rewardPrograms.id, programId), eq(rewardPrograms.workspaceId, ws.workspaceId)));
    if (!program) throw new PointsError('Reward program not found');
    const target = await requireProgramme(tx, ws, programmeId);

    const [link] = await tx.select({ programmeId: earnsInto.programmeId }).from(earnsInto).where(and(eq(earnsInto.programId, programId), eq(earnsInto.workspaceId, ws.workspaceId)));
    const previousId = link?.programmeId ?? programId;
    if (previousId === programmeId) return { previousId: null, previousArchived: false };

    const others = ((await programmeEarners({ db: tx }, ws)).get(previousId) ?? []).filter((earner) => earner.programId !== programId);
    const inWorkspace = eq(pointEntries.workspaceId, ws.workspaceId);
    if (previousId === programId && others.length === 0) {
      await tx.update(pointEntries).set({ programId: programmeId }).where(and(inWorkspace, eq(pointEntries.programId, previousId)));
      await tx.update(pointSnapshots).set({ programId: programmeId }).where(and(eq(pointSnapshots.workspaceId, ws.workspaceId), eq(pointSnapshots.programId, previousId)));
    } else {
      await tx
        .update(pointEntries)
        .set({ programId: programmeId })
        .where(and(inWorkspace, eq(pointEntries.programId, previousId), eq(pointEntries.kind, 'earn'), eq(pointEntries.earnedById, programId)));
    }

    await tx
      .insert(earnsInto)
      .values({ programId, workspaceId: ws.workspaceId, programmeId })
      .onConflictDoUpdate({ target: earnsInto.programId, set: { programmeId } });
    if (target.archivedAt !== null) await tx.update(pointProgrammes).set({ archivedAt: null }).where(eq(pointProgrammes.id, programmeId));

    // Put away only what is truly finished with: nothing earning into it, nothing held in it.
    const left = await tx
      .select({ quantity: pointEntries.quantity })
      .from(pointEntries)
      .where(and(inWorkspace, eq(pointEntries.programId, previousId)));
    const holds = left.reduce((total, row) => total + row.quantity, 0);
    const previous = await findProgramme(tx, ws, previousId);
    const previousArchived = others.length === 0 && Math.abs(holds) < 1e-9 && previous !== undefined && previous.archivedAt === null;
    if (previousArchived) {
      await tx.update(pointProgrammes).set({ archivedAt: new Date().toISOString() }).where(and(eq(pointProgrammes.id, previousId), eq(pointProgrammes.workspaceId, ws.workspaceId)));
    }
    return { previousId, previousArchived };
  });
}

export interface ConversionInput {
  fromProgrammeId: string;
  /** The programme converted into. Give this or `newProgramme`. */
  toProgrammeId?: string;
  /** A programme that does not exist yet — a partner converted into for the first time — made in the same step. */
  newProgramme?: ProgrammeInput;
  /** Points that left the programme converted from. */
  points: number;
  /** What actually arrived in the other programme, in its own unit. */
  received: number;
  occurredOn: string;
}

export interface ConversionResult {
  conversionId: string;
  toProgrammeId: string;
}

/**
 * Converts points from one programme into another, in one step: the points come off the source the way any spending
 * does — from the batches that die soonest, one entry per batch — and what arrived lands in the target as a batch of
 * its own, dying under the target's policy. Both sides carry one conversion id, so removing the conversion removes
 * both and neither balance is left half-moved. A target that does not exist yet is made in the same transaction, so a
 * conversion that fails leaves no empty programme behind.
 *
 * What arrived is taken as typed rather than worked out from the ratio here: the ratio is only the estimate the sheet
 * starts from, and the figure that counts is the one the airline's or hotel's app shows.
 */
export async function recordConversion(database: Database, ws: WorkspaceContext, input: ConversionInput): Promise<ConversionResult> {
  if ((input.toProgrammeId === undefined) === (input.newProgramme === undefined)) throw new PointsError('Choose the programme the points went to');
  if (input.fromProgrammeId === input.toProgrammeId) throw new PointsError('Points convert into another programme, not the same one');
  if (!Number.isFinite(input.points) || input.points <= 0) throw new PointsError('Convert an amount above zero');
  if (!Number.isFinite(input.received) || input.received <= 0) throw new PointsError('Say what arrived in the other programme');

  const from = await requireProgramme(database.db, ws, input.fromProgrammeId);
  const existing = input.toProgrammeId === undefined ? null : await requireProgramme(database.db, ws, input.toProgrammeId);
  let taken: { batchId: string; quantity: number }[];
  try {
    taken = consumeFifo(await listPointEntries(database, ws, from.id), input.points, input.occurredOn);
  } catch (error) {
    throw error instanceof LedgerError ? new PointsError(error.message) : error;
  }

  const conversionId = uuidv7();
  const now = new Date().toISOString();
  const common = { workspaceId: ws.workspaceId, transactionId: null, kind: 'transfer' as const, occurredOn: input.occurredOn, status: 'posted' as const, source: 'manual' as const, valueMinor: null, earnedById: null, conversionId, createdAt: now };
  return database.transaction(async (tx) => {
    const to = existing ?? (await createProgrammeTx(tx, ws, input.newProgramme!));
    await tx.insert(pointEntries).values([
      ...taken.map((batch) => ({ ...common, id: uuidv7(), programId: from.id, quantity: -batch.quantity, batchId: batch.batchId, expiresOn: null, note: `To ${to.name}` })),
      {
        ...common,
        id: uuidv7(),
        programId: to.id,
        quantity: input.received,
        batchId: null,
        // Converted points start a life of their own under the target's policy, from the day they arrived.
        expiresOn: expiryDateFor(input.occurredOn, to.expiryPolicy, to.expiryMonths),
        note: `From ${from.name}`,
      },
    ]);
    return { conversionId, toProgrammeId: to.id };
  });
}

/**
 * Removes a conversion, both sides at once: the points go back to the source and leave the target. Once what arrived
 * has been drawn on — spent, or converted onward — removing it would leave that spending pointing at nothing, so it is
 * refused until that is removed first.
 */
export async function deleteConversion(database: Database, ws: WorkspaceContext, conversionId: string): Promise<void> {
  await database.transaction(async (tx) => {
    const sides = await tx
      .select({ id: pointEntries.id })
      .from(pointEntries)
      .where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.conversionId, conversionId)));
    if (sides.length === 0) return;
    const drawn = await tx
      .select({ id: pointEntries.id, conversionId: pointEntries.conversionId })
      .from(pointEntries)
      .where(and(eq(pointEntries.workspaceId, ws.workspaceId), inArray(pointEntries.batchId, sides.map((side) => side.id))));
    if (drawn.some((entry) => entry.conversionId !== conversionId)) {
      throw new PointsError("What arrived from this conversion has been used since, so it can't be removed on its own");
    }
    await tx.delete(pointEntries).where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.conversionId, conversionId)));
  });
}

/**
 * Brings a programme's ledger up to date before its balance is read: each card earning into it works out the cycle
 * it is in and the one before (as its own page does), and batches past their date are written off.
 *
 * A card cycled by its statement but with no billing date yet has no cycles to work out, so it is passed over.
 */
export async function refreshProgramme(database: Database, ws: WorkspaceContext, programmeId: string, today: string): Promise<void> {
  const earners = (await programmeEarners(database, ws)).get(programmeId) ?? [];
  for (const earner of earners) {
    const [program] = await database.db.select({ cycleAnchor: rewardPrograms.cycleAnchor }).from(rewardPrograms).where(eq(rewardPrograms.id, earner.programId));
    const [terms] = await database.db.select({ statementDay: cardTerms.statementDay }).from(cardTerms).where(and(eq(cardTerms.accountId, earner.cardAccountId), eq(cardTerms.workspaceId, ws.workspaceId)));
    if (program?.cycleAnchor === 'statement' && !terms) continue;
    await backfillCycles(database, ws, earner.programId, 2, today);
  }
  await expireDueEntries(database, ws, programmeId, today);
}

export interface ProgrammeSummary {
  programme: ProgrammeRow;
  earners: ProgrammeEarner[];
  balance: Balance;
}

/** Every programme in sight with its balance and the cards earning into it, for the Cards page. Reads only. */
export async function listProgrammeSummaries(database: Database, ws: WorkspaceContext, today: string): Promise<ProgrammeSummary[]> {
  const programmes = await listProgrammes(database, ws);
  const earners = await programmeEarners(database, ws);
  const out: ProgrammeSummary[] = [];
  for (const programme of programmes) {
    out.push({ programme, earners: earners.get(programme.id) ?? [], balance: balanceOf(await listPointEntries(database, ws, programme.id), today) });
  }
  return out;
}

export type HistoryKind = 'earn' | 'redeem' | 'transfer' | 'convert_out' | 'convert_in' | 'adjust' | 'expire';

/** One line of a programme's history: one act, however many batch entries it took. */
export interface ProgrammeHistoryRow {
  key: string;
  kind: HistoryKind;
  /** The day it happened; for a statement's earning, the day the statement closed. */
  on: string;
  /** Signed, in this programme's unit. */
  quantity: number;
  /** Some of it was only worked out from the card's rules. */
  estimated: boolean;
  /** The card that earned it, the programme on the other side of a conversion, or the note typed with it. */
  label: string | null;
  /** The card's reward program, on a card's earning. */
  earnedById: string | null;
  conversionId: string | null;
  /** The other side of a conversion: what left the source, or what arrived in the target. */
  counterpart: { programmeName: string; quantity: number; unit: ProgrammeUnit } | null;
}

/**
 * A programme's history, newest first. A card's earning is one line per statement (per month, for a card cycled by the
 * calendar); a conversion is one line with both sides; a redemption or a balance read is one line however many
 * batches it drew on; an expiry is one line per day.
 */
export async function programmeHistory(database: Database, ws: WorkspaceContext, programmeId: string): Promise<ProgrammeHistoryRow[]> {
  const entries = await database.db
    .select()
    .from(pointEntries)
    .where(and(eq(pointEntries.workspaceId, ws.workspaceId), eq(pointEntries.programId, programmeId)));

  // Each earning card's name and how its cycles run, to put a purchase's points under its statement.
  const earnerIds = [...new Set(entries.map((entry) => entry.earnedById).filter((id): id is string => id !== null))];
  const cards = earnerIds.length
    ? await database.db
        .select({ id: rewardPrograms.id, cardName: accounts.name, cycleAnchor: rewardPrograms.cycleAnchor, statementDay: cardTerms.statementDay })
        .from(rewardPrograms)
        .innerJoin(accounts, eq(accounts.id, rewardPrograms.cardAccountId))
        .leftJoin(cardTerms, eq(cardTerms.accountId, rewardPrograms.cardAccountId))
        .where(inArray(rewardPrograms.id, earnerIds))
    : [];
  const cardOf = new Map(cards.map((card) => [card.id, card]));

  // The other side of every conversion this programme took part in.
  const conversionIds = [...new Set(entries.map((entry) => entry.conversionId).filter((id): id is string => id !== null))];
  const otherSides = conversionIds.length
    ? await database.db
        .select({ conversionId: pointEntries.conversionId, quantity: pointEntries.quantity, programmeName: pointProgrammes.name, unit: pointProgrammes.unit })
        .from(pointEntries)
        .innerJoin(pointProgrammes, eq(pointProgrammes.id, pointEntries.programId))
        .where(and(eq(pointEntries.workspaceId, ws.workspaceId), inArray(pointEntries.conversionId, conversionIds), ne(pointEntries.programId, programmeId)))
    : [];

  const groups = new Map<string, ProgrammeHistoryRow>();
  const add = (key: string, row: Omit<ProgrammeHistoryRow, 'key' | 'quantity' | 'estimated'>, entry: { quantity: number; status: string }) => {
    const existing = groups.get(key);
    if (existing) {
      existing.quantity += entry.quantity;
      existing.estimated ||= entry.status === 'projected';
      return;
    }
    groups.set(key, { key, ...row, quantity: entry.quantity, estimated: entry.status === 'projected' });
  };

  for (const entry of entries) {
    if (entry.conversionId !== null) {
      const other = otherSides.filter((side) => side.conversionId === entry.conversionId);
      const counterpart = other.length
        ? { programmeName: other[0]!.programmeName, unit: other[0]!.unit, quantity: other.reduce((total, side) => total + side.quantity, 0) }
        : null;
      add(`c:${entry.conversionId}`, { kind: entry.quantity < 0 ? 'convert_out' : 'convert_in', on: entry.occurredOn, label: counterpart?.programmeName ?? null, earnedById: null, conversionId: entry.conversionId, counterpart }, entry);
    } else if (entry.kind === 'earn') {
      const card = entry.earnedById ? cardOf.get(entry.earnedById) : undefined;
      const cycle = card ? cycleFor(entry.occurredOn, card.cycleAnchor, card.statementDay ?? 1) : { start: entry.occurredOn, end: entry.occurredOn };
      add(`e:${entry.earnedById ?? '-'}:${cycle.start}`, { kind: 'earn', on: cycle.end, label: card?.cardName ?? null, earnedById: entry.earnedById, conversionId: null, counterpart: null }, entry);
    } else if (entry.kind === 'expire') {
      add(`x:${entry.occurredOn}`, { kind: 'expire', on: entry.occurredOn, label: null, earnedById: null, conversionId: null, counterpart: null }, entry);
    } else {
      // A redemption or a balance read is written as one entry per batch it touched, all in the same moment.
      add(`${entry.kind}:${entry.createdAt}:${entry.occurredOn}:${entry.note ?? ''}`, { kind: entry.kind, on: entry.occurredOn, label: entry.note, earnedById: null, conversionId: null, counterpart: null }, entry);
    }
  }
  return [...groups.values()].sort((a, b) => b.on.localeCompare(a.on) || a.key.localeCompare(b.key));
}
