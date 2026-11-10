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
import { appNameOfScreen, fingerprintOf, type RawCapture, sameSource, type Template, uuidv7 } from '@expanses/core';
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
  /** Whether this source's offers are read for the purchase they report, rather than skipped. */
  readOffers: boolean;
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
  readOffers: row.readOffers === 1,
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

/** An email sender as Mail hands it over: an address, alone or after a display name ("Bank <alerts@bank.example>"). */
const SENDER = /^(?:(.*?)\s*<\s*)?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+?)\s*>?$/;

/** The words of a domain that say what kind of domain it is, not whose: "alerts.bank.co.id" is the bank's. */
const DOMAIN_KINDS = new Set(['co', 'com', 'net', 'org', 'or', 'ac', 'go', 'gov', 'edu', 'biz', 'mail', 'email']);

/**
 * A sender's source: keyed on its address in lower case, so "Bank <alerts@bank.example>" and "alerts@bank.example"
 * are the same source, and named for the display name it gave — or, with none, for the domain's own name.
 */
function senderOf(app: string): { key: string; label: string } | null {
  if (app.length > 320) return null;
  const match = SENDER.exec(app);
  if (!match) return null;
  const address = match[2]!.toLowerCase();
  const display = (match[1] ?? '').replace(/^["']|["']$/g, '').trim();
  if (display !== '') return { key: address, label: display };
  const parts = address.slice(address.indexOf('@') + 1).split('.');
  parts.pop();
  while (parts.length > 1 && DOMAIN_KINDS.has(parts[parts.length - 1]!)) parts.pop();
  const name = parts[parts.length - 1] ?? '';
  return { key: address, label: name === '' ? address : name.charAt(0).toUpperCase() + name.slice(1) };
}

/**
 * What a capture's source is keyed on: the app that sent it, or the layout of the screen it is a picture of.
 *
 * `legacy` is the key the same capture had before senders were keyed by address — the app exactly as handed over — so
 * a source made then (a message app that names its sender by an email address) is still found, with what it learned.
 */
function keyOf(capture: RawCapture): { keyKind: 'app' | 'fingerprint'; key: string; label: string; legacy?: string } {
  const app = capture.app?.trim();
  if (app) {
    // An email's sender is its app: each bank's address is a source of its own, as an SMS sender is.
    const sender = senderOf(app);
    if (sender) return { keyKind: 'app', ...sender, ...(sender.key === app ? {} : { legacy: app }) };
    return { keyKind: 'app', key: app, label: appNameOf(app) };
  }
  // An image has no app: its top band — the brand, the title bar, the masked digits — is what names it.
  return { keyKind: 'fingerprint', key: JSON.stringify(fingerprintOf(capture)), label: appNameOfScreen(capture) ?? labelOf(capture) };
}

/**
 * What to call a screen, before anyone has said what it is, when it prints no app name that can be trusted: the first
 * thing it says.
 */
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
  /* The very same key is the same source. That is also what keeps a picture with no words at its top to one source:
     an empty fingerprint is like no other fingerprint, but it is like every other empty one, and making a new source
     for each of them would fill the Capture sources list with strangers. */
  const found =
    // A source already kept under the app exactly as it came is that source: its key is never changed under it.
    (wanted.legacy === undefined ? undefined : sameKind.find((row) => row.key === wanted.legacy)) ??
    sameKind.find((row) => row.key === wanted.key) ??
    (wanted.keyKind === 'fingerprint' ? sameKind.find((row) => sameSource(wordsOf(row.key), wordsOf(wanted.key))) : undefined);

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
    // An offer is not a payment: a new source skips its offers until the owner says otherwise.
    readOffers: 0,
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

/** One source by its id, or null when it has been forgotten since. */
export async function sourceById(tx: Db, id: string): Promise<CaptureSource | null> {
  const [row] = await tx.select().from(captureSources).where(eq(captureSources.id, id));
  return row ? toSource(row) : null;
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

/**
 * Whether this source's offers are read for the purchase they report.
 *
 * Some cards announce a purchase only inside a rewards notification, and nothing else ever arrives; for those the
 * offer is the only record there is. It stays off everywhere else, and even on, an offer that names no transaction
 * is skipped as it always was.
 */
export async function setSourceReadsOffers(database: Database, sourceId: string, readOffers: boolean): Promise<void> {
  await database.db
    .update(captureSources)
    .set({ readOffers: readOffers ? 1 : 0, updatedAt: new Date().toISOString() })
    .where(eq(captureSources.id, sourceId));
}
