import { and, eq, sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../context';
import type { Db } from '../database';
import { earnsInto, pointProgrammes } from '../schema-points';

/*
 * The link between a card's earning setup (`reward_programs`) and the balance it earns into (`point_programmes`, 0085).
 * Kept apart from programmes.ts so the card and catalogue repos can open a card's programme without importing the
 * ledger, and the ledger can find a card's programme without importing the programmes repo.
 */

export type ProgrammeRow = typeof pointProgrammes.$inferSelect;

const seen = new WeakSet<object>();

/**
 * Whether 0085 has run. A database stopped before it (a migration test) still sets a card up as it always did, with
 * no programme to open: the migration makes one for it on the way up. Once seen it is remembered, since a table is
 * never taken away.
 */
export async function programmesExist(db: Db): Promise<boolean> {
  if (seen.has(db)) return true;
  const rows = await db.values<[string]>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'point_programmes'`);
  if (rows.length === 0) return false;
  seen.add(db);
  return true;
}

/**
 * A new card's balance: a programme of its own under the reward program's own id, name and unit, with the card earning
 * into it — exactly what 0085 made of every card already set up. Joining it to another programme is the owner's call
 * afterwards (`setEarnsInto`).
 */
export async function openOwnProgrammeTx(
  tx: Db,
  program: { id: string; workspaceId: string; name: string; unit: ProgrammeRow['unit']; createdAt: string },
): Promise<void> {
  if (!(await programmesExist(tx))) return;
  await tx
    .insert(pointProgrammes)
    .values({ id: program.id, workspaceId: program.workspaceId, name: program.name, unit: program.unit, expiryPolicy: 'none', expiryMonths: null, archivedAt: null, createdAt: program.createdAt })
    .onConflictDoNothing();
  await tx.insert(earnsInto).values({ programId: program.id, workspaceId: program.workspaceId, programmeId: program.id }).onConflictDoNothing();
}

/**
 * Catalogue terms applied to a card name the programme it earns into ("Livin' Poin", "KrisFlyer"). They rename that
 * programme only while it is still the card's own — opened with the card and earned into by no other card; a programme
 * the owner has joined cards to is theirs to name.
 */
export async function nameOwnProgrammeTx(tx: Db, ws: WorkspaceContext, programId: string, name: string, unit: ProgrammeRow['unit']): Promise<void> {
  if (!(await programmesExist(tx))) return;
  if ((await programmeIdOf(tx, ws, programId)) !== programId) return;
  const others = await tx
    .select({ programId: earnsInto.programId })
    .from(earnsInto)
    .where(and(eq(earnsInto.programmeId, programId), eq(earnsInto.workspaceId, ws.workspaceId)));
  if (others.some((row) => row.programId !== programId)) return;
  await tx.update(pointProgrammes).set({ name, unit }).where(and(eq(pointProgrammes.id, programId), eq(pointProgrammes.workspaceId, ws.workspaceId)));
}

/** The programme a reward program earns into: its own id when no link is recorded, which after 0085 is never. */
export async function programmeIdOf(db: Db, ws: WorkspaceContext, programId: string): Promise<string> {
  if (!(await programmesExist(db))) return programId;
  const [row] = await db
    .select({ programmeId: earnsInto.programmeId })
    .from(earnsInto)
    .where(and(eq(earnsInto.programId, programId), eq(earnsInto.workspaceId, ws.workspaceId)));
  return row?.programmeId ?? programId;
}

export async function findProgramme(db: Db, ws: WorkspaceContext, programmeId: string): Promise<ProgrammeRow | undefined> {
  const [row] = await db
    .select()
    .from(pointProgrammes)
    .where(and(eq(pointProgrammes.id, programmeId), eq(pointProgrammes.workspaceId, ws.workspaceId)));
  return row;
}
