/**
 * Where captures come from, and what each source has learned.
 *
 * A source is an app, for a notification, or a screen's own layout, for an image: the wallet screen always says
 * "Transaksi Berhasil" and always shows a masked account, and the figures it is about are the one thing that is
 * always different. Recognising a source is what lets the second screenshot need no answer, and what makes the
 * owner's first "Which account is this?" last.
 *
 * Everything here is local. What somebody's banking screens look like is not a fact about their money.
 */
import { fingerprintOf, type RawCapture, sameSource, type Template, uuidv7 } from '@expanses/core';
import { asc, eq } from 'drizzle-orm';
import type { Database, Db } from '../database';
import { captureSources } from '../schema-capture';

/** One source, as the screens read it. */
export interface CaptureSource {
  id: string;
  keyKind: 'app' | 'fingerprint';
  key: string;
  label: string;
  accountId: string | null;
  workspaceId: string | null;
  template: Template | null;
  capturedCount: number;
}

/** What a source learned about where its fields sit, as it was written down. */
export function templateOf(json: string | null): Template | null {
  if (!json) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === 'object' ? (parsed as Template) : null;
  } catch {
    return null;
  }
}

/** A fingerprint is kept as the words it is made of, so two of them can be compared as sets. */
function wordsOf(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(key);
    return Array.isArray(parsed) ? parsed.filter((word): word is string => typeof word === 'string') : [];
  } catch {
    return [];
  }
}

const toSource = (row: typeof captureSources.$inferSelect): CaptureSource => ({
  id: row.id,
  keyKind: row.keyKind,
  key: row.key,
  label: row.label,
  accountId: row.accountId,
  workspaceId: row.workspaceId,
  template: templateOf(row.templateJson),
  capturedCount: row.capturedCount,
});

/**
 * The name an app id ends in: `com.example.pay` is the Pay app. A value that is already a name is left alone.
 *
 * What the phone hands over is often a display name, but a shortcut can map an identifier instead, and a row that
 * says `com.example.pay` is no way to meet your own money.
 */
function appNameOf(app: string): string {
  const name = app.includes('.') ? app.slice(app.lastIndexOf('.') + 1) : app;
  return name === '' ? app : name.charAt(0).toUpperCase() + name.slice(1);
}

/** What a capture's source is keyed on: the app that sent it, or the layout of the screen it is a picture of. */
function keyOf(capture: RawCapture): { keyKind: 'app' | 'fingerprint'; key: string; label: string } {
  const app = capture.app?.trim();
  if (app) return { keyKind: 'app', key: app, label: appNameOf(app) };
  // An image has no app: its top band — the brand, the title bar, the masked digits — is what names it.
  return { keyKind: 'fingerprint', key: JSON.stringify(fingerprintOf(capture)), label: labelOf(capture) };
}

/** What to call a screen, before anyone has said what it is: the first thing it says. */
function labelOf(capture: RawCapture): string {
  return capture.lines[0]?.text.trim() || capture.title?.trim() || 'Capture';
}

/**
 * The source a capture came from, made if this is the first time one of its kind has been seen.
 *
 * The count is kept so the Capture sources screen can say whether a source is being used, and so a reset that looks
 * like it did nothing can be told from one that was never given anything.
 */
export async function sourceFor(tx: Db, capture: RawCapture, count = true): Promise<CaptureSource> {
  const wanted = keyOf(capture);
  const sameKind = await tx.select().from(captureSources).where(eq(captureSources.keyKind, wanted.keyKind));
  const found =
    wanted.keyKind === 'app'
      ? sameKind.find((row) => row.key === wanted.key)
      : sameKind.find((row) => sameSource(wordsOf(row.key), wordsOf(wanted.key)));

  const now = new Date().toISOString();
  if (found) {
    const capturedCount = found.capturedCount + (count ? 1 : 0);
    if (count) {
      await tx.update(captureSources).set({ capturedCount, updatedAt: now }).where(eq(captureSources.id, found.id));
    }
    return toSource({ ...found, capturedCount });
  }

  const created: typeof captureSources.$inferInsert = {
    id: uuidv7(),
    // Nobody has said whose it is yet, so a new source belongs to no workspace and asks for its account.
    workspaceId: null,
    keyKind: wanted.keyKind,
    key: wanted.key,
    label: wanted.label,
    accountId: null,
    templateJson: null,
    capturedCount: count ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };
  await tx.insert(captureSources).values(created);
  return toSource(created as typeof captureSources.$inferSelect);
}

/** The answer to "Which account is this?": from now on, this source's captures are filed there. */
export async function setSourceAccount(
  database: Database,
  sourceId: string,
  accountId: string,
  workspaceId: string,
): Promise<void> {
  await database.db
    .update(captureSources)
    .set({ accountId, workspaceId, updatedAt: new Date().toISOString() })
    .where(eq(captureSources.id, sourceId));
}

/** Every source this device knows, oldest first: the order the owner met them in. */
export async function listSources(database: Database): Promise<CaptureSource[]> {
  const rows = await database.db.select().from(captureSources).orderBy(asc(captureSources.createdAt), asc(captureSources.label));
  return rows.map(toSource);
}

/**
 * Forgets where a source's fields sat, keeping whose it is.
 *
 * A source that learns the wrong place keeps getting it wrong — the anchor is tried before the general reader — so
 * there has to be a way back to reading the screen from scratch.
 */
export async function resetSourceTemplate(database: Database, sourceId: string): Promise<void> {
  await database.db
    .update(captureSources)
    .set({ templateJson: null, updatedAt: new Date().toISOString() })
    .where(eq(captureSources.id, sourceId));
}

/** Forgets a source completely: the next capture of it is a stranger again, and asks which account it is. */
export async function deleteSource(database: Database, sourceId: string): Promise<void> {
  await database.db.delete(captureSources).where(eq(captureSources.id, sourceId));
}
