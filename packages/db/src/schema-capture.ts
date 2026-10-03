import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Where the owner's captures come from, and what each source has learned.
 *
 * A source is an app for a notification, or the layout of a screen for an image. It holds the account its captures are
 * posted to and the places its fields were found last time, so the second screenshot of the same wallet screen needs no
 * reading at all. Local to the device: what somebody's banking screens look like is not a fact about their money that
 * belongs on a server.
 */
export const captureSources = sqliteTable('capture_sources', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id'),
  /** An app's own name, or the fingerprint of an image's top band. */
  keyKind: text('key_kind', { enum: ['app', 'fingerprint'] }).notNull(),
  key: text('key').notNull(),
  label: text('label').notNull(),
  /** The account this source's captures are posted to, learned from the first "Which account is this?". */
  accountId: text('account_id'),
  /** `{ amount?: Anchor, name?: Anchor, date?: Anchor }` — where each field was found when it was corrected. */
  templateJson: text('template_json'),
  capturedCount: integer('captured_count').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** A capture that produced no draft, kept so the same offer is never offered twice. */
export const captureSkipped = sqliteTable('capture_skipped', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  reason: text('reason', { enum: ['promo', 'expenses-only'] }).notNull(),
  captureJson: text('capture_json').notNull(),
  readingJson: text('reading_json').notNull(),
  skippedAt: text('skipped_at').notNull(),
});

/** Settings the capture screens own: `scope` is `everything` or `expenses-only`. */
export const captureSettings = sqliteTable('capture_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
