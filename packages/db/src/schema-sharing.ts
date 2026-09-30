import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Household sharing's side tables (0056, spec §4.2). No column is added to any existing table. */

export const sharedBooks = sqliteTable('shared_books', {
  bookId: text('book_id').primaryKey(),
  relayBookId: text('relay_book_id').notNull(),
  epoch: integer('epoch').notNull(),
  memberId: text('member_id').notNull(),
  state: text('state', { enum: ['active', 'needs_invite', 'unshared'] }).notNull(),
  sharedAt: text('shared_at').notNull(),
  /** When this device last finished a sync of the book (§11). */
  syncedAt: text('synced_at'),
  /** The member who ended the sharing here, for "No longer shared by …" (§8.6). */
  unsharedBy: text('unshared_by'),
  /** How it ended (final review, I2): its owner stopped it, this member left, or this device was removed. */
  unsharedReason: text('unshared_reason', { enum: ['stopped', 'left', 'removed'] }),
});

export const bookMembers = sqliteTable(
  'book_members',
  {
    bookId: text('book_id').notNull(),
    memberId: text('member_id').notNull(),
    name: text('name').notNull(),
    role: text('role', { enum: ['owner', 'member'] }).notNull(),
    joinedAt: text('joined_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.memberId] })],
);

export const bookDevices = sqliteTable(
  'book_devices',
  {
    bookId: text('book_id').notNull(),
    deviceId: text('device_id').notNull(),
    memberId: text('member_id').notNull(),
    name: text('name').notNull(),
    signJwk: text('sign_jwk').notNull(),
    agreeJwk: text('agree_jwk').notNull(),
    addedAt: text('added_at').notNull(),
    removedAt: text('removed_at'),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.deviceId] })],
);

/** The hidden placeholder account per other member and currency (spec §4.4), one per (book, member, currency). */
export const bookMemberAccounts = sqliteTable('book_member_accounts', {
  accountId: text('account_id').primaryKey(),
  bookId: text('book_id').notNull(),
  memberId: text('member_id').notNull(),
  currency: text('currency').notNull(),
});

export const bookEpochKeys = sqliteTable(
  'book_epoch_keys',
  {
    bookId: text('book_id').notNull(),
    epoch: integer('epoch').notNull(),
    keySealed: text('key_sealed').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.epoch] })],
);

/** A purchase's lineage -> its current head (spec §6.3). */
export const syncLineage = sqliteTable('sync_lineage', {
  lineageId: text('lineage_id').primaryKey(),
  bookId: text('book_id').notNull(),
  headTransactionId: text('head_transaction_id'),
  paidBy: text('paid_by').notNull(),
  paidLabel: text('paid_label').notNull(),
  /** Joint net worth §5.3: whose shared item the money side is on (migration 0058); null = the payer's own account. */
  paidFromOwner: text('paid_from_owner'),
  paidFromItem: text('paid_from_item'),
});

export const syncOutbox = sqliteTable('sync_outbox', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull(),
  hlc: text('hlc').notNull(),
  entryJson: text('entry_json').notNull(),
  createdAt: text('created_at').notNull(),
});

export const syncCursor = sqliteTable('sync_cursor', {
  bookId: text('book_id').primaryKey(),
  appliedSeq: integer('applied_seq').notNull().default(0),
});

export const syncFieldClocks = sqliteTable(
  'sync_field_clocks',
  {
    bookId: text('book_id').notNull(),
    entity: text('entity').notNull(),
    id: text('id').notNull(),
    field: text('field').notNull(),
    hlc: text('hlc').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.entity, t.id, t.field] })],
);

/** A book's field clocks and values as they stood when this device stopped keeping them (recovery review, N2; §8.6, §8.7). */
export const syncKeptClocks = sqliteTable(
  'sync_kept_clocks',
  {
    bookId: text('book_id').notNull(),
    entity: text('entity').notNull(),
    id: text('id').notNull(),
    field: text('field').notNull(),
    hlc: text('hlc').notNull(),
    valueJson: text('value_json').notNull(),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.entity, t.id, t.field] })],
);

export const syncTombstones = sqliteTable(
  'sync_tombstones',
  {
    bookId: text('book_id').notNull(),
    entity: text('entity').notNull(),
    id: text('id').notNull(),
    hlc: text('hlc').notNull(),
    /** A revivable row's last field values, kept beside its tombstone so a revive merges with them (§7.2). */
    lastJson: text('last_json'),
  },
  (t) => [primaryKey({ columns: [t.bookId, t.entity, t.id] })],
);

/** An op apply refused deterministically, recorded so it is never a silent divergence (spec §7.1, task 4 fix round 1). */
export const syncSkipped = sqliteTable('sync_skipped', {
  bookId: text('book_id').notNull(),
  seq: integer('seq').notNull(),
  entity: text('entity').notNull(),
  id: text('id').notNull(),
  error: text('error').notNull(),
  at: text('at').notNull(),
});
