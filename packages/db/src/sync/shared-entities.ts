import { sql, type SQL } from 'drizzle-orm';

/*
 * What syncs in a shared book (household-sharing spec §4.1). One record per synced entity: its table, how a row is
 * found to be in a book, how its `Op.id` is built, and exactly which fields travel. Nothing outside this list is ever
 * sent. `workspace_id` is never sent: apply stamps the local workspace id on every row it inserts.
 *
 * Checked against the code at 725f284 (spec step 0); the findings are in
 * docs/superpowers/specs/2026-09-27-household-sharing-v3-check.md. This constant is the truth where the two differ.
 */

/** Separates the parts of a composite `Op.id`, in `keyColumns` order. Never includes `workspace_id`. */
export const OP_ID_SEPARATOR = '|';

/** An entity whose rows are edited in place: one table, one row per `Op.id`, captured by `withCapture`. */
export interface RowEntity {
  kind: 'row';
  entity: string;
  table: string;
  /** Plain words for the scope rule, as the spec states it. */
  scopeRule: string;
  /** SQL predicate over the entity's table aliased `t`: true when the row is in `bookId`'s book. */
  scope: (bookId: string) => SQL;
  /** The columns whose values, joined by `OP_ID_SEPARATOR` in this order, make the `Op.id`. */
  keyColumns: readonly string[];
  /** Synced field name → the column in `table` it is read from and written to. */
  fields: Readonly<Record<string, string>>;
  /**
   * Fields that do not map one-to-one onto a column. Each is read and written by code, never copied: the key is the
   * field, the value is the columns it stands for (in `table`).
   */
  derivedFields?: Readonly<Record<string, readonly string[]>>;
  /** Columns that never travel but are NOT NULL without a default: apply writes a local value on insert. */
  localOnInsert: readonly string[];
  /** Made by migration 0056 (spec §4.2), so absent from a database migrated today. */
  createdBy0056?: true;
  /**
   * Joint-net-worth spec §5.1: the member allowed to write this row, read from the op's fields merged over the row
   * already here (so a partial edit is judged by the row's owner, not just what it names) and the op's key.
   * `'either-party'` (a `member_transfer`) means either side of the transfer, read from its `from`/`to` fields'
   * `owner`. `null` (the default, entities without a `writer`) means anyone may write it, as before. Checked in
   * `apply.ts`'s `applyRowOp`.
   */
  writer?: (fields: Record<string, unknown>, key: Record<string, string>) => string | 'either-party' | null;
}

/** The purchase: a lineage of `transactions` rows and the rows about them, captured at the ledger's doors. */
export interface PurchaseEntity {
  kind: 'purchase';
  entity: 'purchase';
  /** The head row's table. The lineage's other rows are in `tables`. */
  table: 'transactions';
  tables: readonly string[];
  scopeRule: string;
  /** Over `transactions` aliased `t`: the row is filed in the book (only rows with an income or expense entry are). */
  scope: (bookId: string) => SQL;
  /** `Op.id` is the lineage id: the id of the first `transactions` row in a `replaces_transaction_id` chain. */
  keyColumns: readonly ['lineage_id'];
  /** Synced field name → the `table.column`s it is read from and written through (by the ledger, never directly). */
  fields: Readonly<Record<string, readonly string[]>>;
  /** `table.column`s that tie the lineage's rows together locally: rewritten by the ledger, never sent. */
  linkColumns: readonly string[];
}

export type SharedEntity = RowEntity | PurchaseEntity;

const inBookCategories = (bookId: string, column: SQL) =>
  sql`${column} IN (SELECT category_account_id FROM book_categories WHERE book_id = ${bookId})`;

const budgetsOfBook = (bookId: string) =>
  sql`SELECT b.id FROM budgets b JOIN book_categories bc ON bc.category_account_id = b.category_account_id WHERE bc.book_id = ${bookId}`;

const billsOfBook = (bookId: string) =>
  sql`SELECT x.id FROM expense_templates x JOIN book_categories bc ON bc.category_account_id = x.category_account_id WHERE bc.book_id = ${bookId}`;

/** The goals whose link to the book is on: what the goal-family entities are scoped by. */
const goalsOn = (bookId: string) => sql`(SELECT goal_id FROM goal_shares WHERE book_id = ${bookId} AND state = 'on')`;

/** The six entities scoped by "on links": they leave the book together when a goal's sharing is turned off. */
export const GOAL_FAMILY: ReadonlySet<string> = new Set(['goal', 'goal_stage', 'goal_stage_term', 'goal_calculator', 'goal_member_funding', 'goal_member_move']);

export const SHARED_ENTITIES: readonly SharedEntity[] = [
  {
    kind: 'row',
    entity: 'book',
    table: 'books',
    scopeRule: 'id = bookId',
    scope: (bookId) => sql`t.id = ${bookId}`,
    keyColumns: ['id'],
    fields: { name: 'name', baseCurrency: 'base_currency', countEventsInBudget: 'count_events_in_budget', archivedAt: 'archived_at' },
    // `kind` is the owner's label and never travels; a joiner inserts 'shared' (spec §4.2).
    localOnInsert: ['kind', 'created_at'],
  },
  {
    kind: 'row',
    entity: 'category',
    table: 'accounts',
    scopeRule: 'id is in book_categories for the book',
    scope: (bookId) => inBookCategories(bookId, sql`t.id`),
    keyColumns: ['id'],
    fields: {
      name: 'name',
      parentId: 'parent_id',
      kind: 'kind',
      subtype: 'subtype',
      currency: 'currency',
      icon: 'icon',
      // A category keeps its system key per book (0043) so card earning rules recognise it on every device.
      systemKey: 'system_key',
      sortOrder: 'sort_order',
      archivedAt: 'archived_at',
    },
    // valuation_mode has a default ('derived'); created_at has none.
    localOnInsert: ['created_at'],
  },
  {
    kind: 'row',
    entity: 'category_need',
    table: 'category_needs',
    scopeRule: 'category_account_id is a category of the book',
    scope: (bookId) => inBookCategories(bookId, sql`t.category_account_id`),
    // Ruled O4: a category's need-or-choice mark (0053) travels with the category.
    keyColumns: ['category_account_id'],
    fields: { need: 'need' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'category_colour',
    table: 'category_colours',
    scopeRule: 'category_account_id is a category of the book',
    scope: (bookId) => inBookCategories(bookId, sql`t.category_account_id`),
    // A top-level category's hand-picked colour (0060) travels with the category, as its need does.
    keyColumns: ['category_account_id'],
    fields: { colour: 'colour' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'member',
    table: 'book_members',
    scopeRule: 'book_id = bookId',
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['member_id'],
    fields: { name: 'name', role: 'role', joinedAt: 'joined_at' },
    localOnInsert: ['book_id'],
    createdBy0056: true,
  },
  {
    kind: 'row',
    entity: 'device',
    table: 'book_devices',
    scopeRule: 'book_id = bookId',
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['device_id'],
    fields: {
      memberId: 'member_id',
      name: 'name',
      signJwk: 'sign_jwk',
      agreeJwk: 'agree_jwk',
      addedAt: 'added_at',
      removedAt: 'removed_at',
      // The app version this device last wrote its own row at (joint-net-worth spec §9): read by every peer to
      // decide whether it meets NET_WORTH_MIN_APP_VERSION before proposing joint mode.
      appVersion: 'app_version',
    },
    localOnInsert: ['book_id'],
    createdBy0056: true,
  },
  {
    kind: 'row',
    entity: 'budget',
    table: 'budgets',
    scopeRule: 'category_account_id is a category of the book',
    scope: (bookId) => inBookCategories(bookId, sql`t.category_account_id`),
    keyColumns: ['id'],
    fields: { categoryAccountId: 'category_account_id', amountMinor: 'amount_minor' },
    localOnInsert: ['created_at', 'updated_at'],
  },
  {
    kind: 'row',
    entity: 'budget_override',
    table: 'budget_overrides',
    scopeRule: 'its budget_id is a budget of the book',
    scope: (bookId) => sql`t.budget_id IN (${budgetsOfBook(bookId)})`,
    keyColumns: ['id'],
    fields: { budgetId: 'budget_id', month: 'month', amountMinor: 'amount_minor' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'budget_frequency',
    table: 'budget_frequencies',
    scopeRule: 'its budget_id is a budget of the book',
    scope: (bookId) => sql`t.budget_id IN (${budgetsOfBook(bookId)})`,
    // Settled (spec §15): keyed by budget_id, one row per budget (0053).
    keyColumns: ['budget_id'],
    fields: { frequency: 'frequency', amountAsSetMinor: 'amount_as_set_minor' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'budget_share',
    table: 'budget_shares',
    scopeRule: 'its budget_id is a budget of the book',
    scope: (bookId) => sql`t.budget_id IN (${budgetsOfBook(bookId)})`,
    // Keyed by budget_id, one row per budget (0070), as budget_frequency is.
    keyColumns: ['budget_id'],
    fields: { basis: 'basis', shareBp: 'share_bp' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'book_income',
    table: 'book_budget_settings',
    scopeRule: 'book_id = bookId',
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['book_id'],
    fields: { expectedIncomeMinor: 'expected_income_minor' },
    localOnInsert: ['updated_at'],
  },
  {
    kind: 'row',
    entity: 'book_income_override',
    table: 'book_income_overrides',
    scopeRule: 'book_id = bookId',
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['book_id', 'month'],
    fields: { amountMinor: 'amount_minor' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'bill',
    table: 'expense_templates',
    scopeRule: 'category_account_id is a category of the book',
    scope: (bookId) => inBookCategories(bookId, sql`t.category_account_id`),
    keyColumns: ['id'],
    fields: {
      name: 'name',
      categoryAccountId: 'category_account_id',
      amountMinor: 'amount_minor',
      dayOfMonth: 'day_of_month',
      active: 'active',
      archivedAt: 'archived_at',
      // Optional (0098): the currency the bill is written in, null while it follows the payer. A build before 0098 never
      // sends it and skips it when it arrives (apply writes only the fields it knows), so the two stay compatible.
      currency: 'currency',
      // Optional (0099): 'yearly' and its month of the year; null while the bill repeats every month. A build before 0099 skips
      // both and would treat the bill as monthly, the one thing an older partner build gets wrong.
      repeat: 'repeat',
      repeatMonth: 'repeat_month',
      // Optional (0102): months between occurrences of a repeat = 'months' bill. Older builds skip it and read the bill as monthly.
      repeatEvery: 'repeat_every',
    },
    // `payer` = { memberId, label } stands for money_account_id, which names an owner-scope account (spec §4.4).
    derivedFields: { payer: ['money_account_id'] },
    localOnInsert: ['created_at'],
  },
  {
    kind: 'row',
    entity: 'bill_window',
    table: 'bill_windows',
    scopeRule: 'its template_id is a bill of the book',
    scope: (bookId) => sql`t.template_id IN (${billsOfBook(bookId)})`,
    keyColumns: ['template_id'],
    fields: { payByDay: 'pay_by_day', startsMonth: 'starts_month' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'bill_skip',
    table: 'bill_skips',
    scopeRule: 'its template_id is a bill of the book',
    scope: (bookId) => sql`t.template_id IN (${billsOfBook(bookId)})`,
    // The table's key is (workspace_id, template_id, month); workspace_id differs per device and is dropped.
    keyColumns: ['template_id', 'month'],
    fields: {},
    localOnInsert: ['created_at'],
  },
  {
    kind: 'row',
    entity: 'bill_pause',
    table: 'bill_pauses',
    scopeRule: 'its template_id is a bill of the book',
    scope: (bookId) => sql`t.template_id IN (${billsOfBook(bookId)})`,
    // Keyed as a skip is: (workspace_id, template_id, month), with workspace_id dropped since it differs per device.
    keyColumns: ['template_id', 'month'],
    fields: {},
    localOnInsert: ['created_at'],
  },
  {
    kind: 'row',
    entity: 'net_worth_group',
    table: 'group_logs',
    // The one joint-net-worth row of the WORKSPACE log (joint-net-worth spec §4, task 4): which group log the
    // workspace's net-worth group keeps, and the relay invites to it, each sealed to one admitted device. A member
    // outside the group learns that a group exists and how many invites wait, nothing else.
    scopeRule: "book_id = bookId (the workspace's own book id)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['book_id'],
    // `groupBookId` and `relayBookId` are written once (authority.ts `WRITER_FROZEN_FIELDS`, task 4 review round 1):
    // a member outside the group cannot point a not-yet-joined member at a log of their own. `invites` stays appendable.
    fields: { groupBookId: 'group_book_id', relayBookId: 'relay_book_id', invites: 'invites_json' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'nw_proposal',
    table: 'nw_proposals',
    scopeRule: "book_id = bookId (the group log's local book id)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['proposal_id'],
    fields: { mode: 'mode', members: 'members_json', proposedBy: 'proposed_by', createdHlc: 'created_hlc', cancelled: 'cancelled' },
    localOnInsert: ['book_id'],
    // Its proposer alone writes it (joint-net-worth spec §5.1), `cancelled` included: nobody else may withdraw it.
    writer: (fields) => (typeof fields.proposedBy === 'string' ? fields.proposedBy : null),
  },
  {
    kind: 'row',
    entity: 'nw_answer',
    table: 'nw_answers',
    scopeRule: "book_id = bookId (the group log's local book id)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['proposal_id', 'member_id'],
    fields: { answer: 'answer' },
    localOnInsert: ['book_id'],
    // Each member answers only for themselves.
    writer: (_fields, key) => key.member_id ?? null,
  },
  {
    kind: 'row',
    entity: 'nw_item',
    table: 'nw_items',
    scopeRule: "book_id = bookId (the group log's local book id)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['item_id'],
    fields: { owner: 'owner', summary: 'summary_json', removed: 'removed' },
    localOnInsert: ['book_id'],
    // Its owner alone writes it, in joint mode as much as separate.
    writer: (fields) => (typeof fields.owner === 'string' ? fields.owner : null),
  },
  {
    kind: 'row',
    entity: 'nw_pending',
    table: 'nw_pending',
    scopeRule: "book_id = bookId (the group log's local book id)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['member_id'],
    // `ring` and `ringDevices` (0110): the member's own ring colour and the devices that read it (sync/net-worth/rings.ts).
    // A build from before them applies `count` and passes them over.
    fields: { count: 'count', ring: 'ring_json', ringDevices: 'ring_devices_json' },
    localOnInsert: ['book_id'],
    // Each member's own pending count, and own ring colour, are theirs to write.
    writer: (_fields, key) => key.member_id ?? null,
  },
  {
    kind: 'row',
    entity: 'book_transfer',
    table: 'shared_transfers',
    scopeRule: 'book_id = bookId (a transfer recorded in the shared workspace, redacted: no accounts)',
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['transfer_id'],
    // `eventBookId` (0114): the shared event the transfer is listed on instead of the workspace. A build from before it
    // applies the rest and passes it over; a recorder moves one only once every device in the workspace has the field
    // (`TRIP_TRANSFERS_MIN_APP_VERSION`).
    fields: {
      occurredOn: 'occurred_on',
      amountMinor: 'amount_minor',
      currency: 'currency',
      description: 'description',
      recordedBy: 'recorded_by',
      void: 'void',
      fromName: 'from_name',
      toName: 'to_name',
      fromItem: 'from_item',
      toItem: 'to_item',
      eventBookId: 'event_book_id',
    },
    localOnInsert: ['book_id'],
    // Only the member who recorded it writes it.
    writer: (fields) => (typeof fields.recordedBy === 'string' ? fields.recordedBy : null),
  },
  {
    kind: 'row',
    entity: 'member_transfer',
    table: 'member_transfers',
    scopeRule: "book_id = bookId (the group log's local book id)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['transfer_id'],
    fields: {
      occurredOn: 'occurred_on',
      amountMinor: 'amount_minor',
      currency: 'currency',
      from: 'from_json',
      to: 'to_json',
      description: 'description',
      void: 'void',
      recordedBy: 'recorded_by',
    },
    localOnInsert: ['book_id'],
    // Either side of the transfer may write it (its payer or its receiver): apply.ts resolves the sentinel against
    // `from.owner` and `to.owner`.
    writer: () => 'either-party',
  },
  /*
   * Shared events (shared events spec §3): the seven entities of an event's own relay book — a shared_books row with no
   * books row, as the net-worth group log is, tied to no workspace. book_id is that book's local id, written on insert;
   * each record's own id is `id`, so a deleted category or item never comes back (rule 3). Who may write what is
   * `events/authority.ts`'s, judged from the op, the stored row and the author alone (rulings R1–R3): none has a
   * `writer` here.
   */
  {
    kind: 'row',
    entity: 'shared_event',
    table: 'shared_events',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['book_id'],
    fields: { name: 'name', startsOn: 'starts_on', endsOn: 'ends_on', currency: 'currency', finishedAt: 'finished_at' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'event_person',
    table: 'event_people',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: { name: 'name', memberId: 'member_id', removedAt: 'removed_at' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_category',
    table: 'event_categories',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: { name: 'name', icon: 'icon', sortOrder: 'sort_order', archivedAt: 'archived_at' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_expense',
    table: 'event_expenses',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: {
      occurredOn: 'occurred_on',
      amountMinor: 'amount_minor',
      currency: 'currency',
      rateToEvent: 'rate_to_event',
      payerPersonId: 'payer_person_id',
      // Ruling R2: null for money paid outside the app, else the payer's member — who alone writes this row.
      payerMemberId: 'payer_member_id',
      voidedAt: 'voided_at',
    },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_expense_detail',
    table: 'event_expense_details',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: { note: 'note', categoryId: 'category_id', splitMode: 'split_mode', splitJson: 'split_json', recordedBy: 'recorded_by', updatedBy: 'updated_by' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_settlement',
    table: 'event_settlements',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: {
      occurredOn: 'occurred_on',
      fromPersonId: 'from_person_id',
      toPersonId: 'to_person_id',
      fromMemberId: 'from_member_id',
      toMemberId: 'to_member_id',
      amountMinor: 'amount_minor',
      voidedAt: 'voided_at',
    },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'event_item',
    table: 'event_items_shared',
    scopeRule: "book_id = bookId (the event's relay book)",
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['id'],
    fields: {
      name: 'name',
      quantity: 'quantity',
      unitPriceMinor: 'unit_price_minor',
      categoryId: 'category_id',
      link: 'link',
      note: 'note',
      expenseId: 'expense_id',
      shareMinor: 'share_minor',
      sortOrder: 'sort_order',
      // 0079: every payment, as one JSON array field, and the done mark. A phone a version behind drops both on apply.
      purchases: 'purchases_json',
      doneAt: 'done_at',
    },
    localOnInsert: ['book_id'],
  },
  /*
   * Shared goals (shared goals spec §8.1): one goal at a time rides the household book. goal_share is the link, in the
   * book whatever its state; the six goal-family entities are in the book only while a link to it is 'on' (GOAL_FAMILY),
   * so turning sharing off takes the rest out of scope. Who may write the link and the goal's own rows is
   * `goals/authority.ts`'s (judged from the op, the stored row and the author): they have no `writer` here. A member's
   * summary and moves are that member's alone. Rank, the standing amount and note, and every account stay on the phone.
   */
  {
    kind: 'row',
    entity: 'goal_share',
    table: 'goal_shares',
    scopeRule: 'book_id = bookId (any state)',
    scope: (bookId) => sql`t.book_id = ${bookId}`,
    keyColumns: ['goal_id'],
    fields: { sharedBy: 'shared_by', state: 'state', stateOn: 'state_on', round: 'round' },
    localOnInsert: ['book_id'],
  },
  {
    kind: 'row',
    entity: 'goal_share_leave',
    table: 'goal_share_leaves',
    scopeRule: 'goal_id has a link in the book (any state)',
    scope: (bookId) => sql`t.goal_id IN (SELECT goal_id FROM goal_shares WHERE book_id = ${bookId})`,
    keyColumns: ['goal_id', 'member_id'],
    fields: { round: 'round', leftOn: 'left_on' },
    localOnInsert: [],
    // A member leaves for themselves only, never the link's sharer for them.
    writer: (_fields, key) => key.member_id ?? null,
  },
  {
    kind: 'row',
    entity: 'goal',
    table: 'goals',
    scopeRule: "id has a link in the book that is 'on'",
    scope: (bookId) => sql`t.id IN ${goalsOn(bookId)}`,
    keyColumns: ['id'],
    fields: { name: 'name', kind: 'kind', growthBps: 'growth_bps', returnBps: 'return_bps', currency: 'currency', status: 'status' },
    localOnInsert: ['created_at'],
  },
  {
    kind: 'row',
    entity: 'goal_stage',
    table: 'goal_stages',
    scopeRule: "goal_id has a link in the book that is 'on'",
    scope: (bookId) => sql`t.goal_id IN ${goalsOn(bookId)}`,
    keyColumns: ['id'],
    fields: {
      goalId: 'goal_id',
      name: 'name',
      targetMinor: 'target_minor',
      targetMonths: 'target_months',
      dueOn: 'due_on',
      sort: 'sort',
      paidOn: 'paid_on',
    },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'goal_stage_term',
    table: 'goal_stage_terms',
    scopeRule: "goal_id has a link in the book that is 'on'",
    scope: (bookId) => sql`t.goal_id IN ${goalsOn(bookId)}`,
    keyColumns: ['stage_id'],
    fields: { goalId: 'goal_id', returnBps: 'return_bps', derivedKey: 'derived_key' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'goal_calculator',
    table: 'goal_calculators',
    scopeRule: "goal_id has a link in the book that is 'on'",
    scope: (bookId) => sql`t.goal_id IN ${goalsOn(bookId)}`,
    keyColumns: ['goal_id'],
    fields: { kind: 'kind', inputs: 'inputs_json', computedMinor: 'computed_minor', computedAt: 'computed_at' },
    localOnInsert: [],
  },
  {
    kind: 'row',
    entity: 'goal_member_funding',
    table: 'goal_member_funding',
    scopeRule: "goal_id has a link in the book that is 'on'",
    scope: (bookId) => sql`t.goal_id IN ${goalsOn(bookId)}`,
    keyColumns: ['goal_id', 'member_id'],
    fields: { lines: 'lines_json', plannedMonthlyMinor: 'planned_monthly_minor', asOf: 'as_of' },
    localOnInsert: [],
    // Each member's phone writes its own summary, as each answers a proposal for themselves.
    writer: (_fields, key) => key.member_id ?? null,
  },
  {
    kind: 'row',
    entity: 'goal_member_move',
    table: 'goal_member_moves',
    scopeRule: "goal_id has a link in the book that is 'on'",
    scope: (bookId) => sql`t.goal_id IN ${goalsOn(bookId)}`,
    keyColumns: ['id'],
    fields: {
      goalId: 'goal_id',
      memberId: 'member_id',
      kind: 'kind',
      occurredOn: 'occurred_on',
      amountMinor: 'amount_minor',
      currency: 'currency',
      text: 'text',
      stageId: 'stage_id',
    },
    localOnInsert: [],
    // The member a line names writes it; memberId is frozen once the row exists (authority.ts).
    writer: (fields) => (typeof fields.memberId === 'string' ? fields.memberId : null),
  },
  {
    kind: 'purchase',
    entity: 'purchase',
    table: 'transactions',
    // 0084: a purchase split across workspaces is filed in book_transaction_splits instead, and travels in its one shared
    // workspace as its part there (capture.ts `projectPurchase`).
    tables: ['transactions', 'entries', 'book_transactions', 'book_transaction_splits', 'transaction_flags', 'bill_payments', 'transaction_line_excluded'],
    scopeRule:
      "the lineage's head is in book_transactions for the book (the ledger files only rows with an income or expense entry), or has a part of a split across workspaces in it (book_transaction_splits)",
    scope: (bookId) =>
      sql`(t.id IN (SELECT transaction_id FROM book_transactions WHERE book_id = ${bookId}) OR t.id IN (SELECT transaction_id FROM book_transaction_splits WHERE book_id = ${bookId}))`,
    keyColumns: ['lineage_id'],
    fields: {
      occurredOn: ['transactions.occurred_on'],
      description: ['transactions.description'],
      channel: ['transaction_flags.channel'],
      // 0090: a split's part in the book is excluded on its own; that part is all that travels, so its flag is the
      // purchase's (capture.ts `projectPurchase`, and apply writes it back to the part).
      excluded: ['transaction_flags.excluded', 'book_transaction_splits.excluded'],
      // 0096: the lines left out one by one, by category (absent when none is). `excluded` is still 1 when every one is,
      // so a phone a version behind reads a purchase excluded whole as before and drops this field on apply.
      excludedLines: ['transaction_line_excluded.account_id'],
      // Both halves: the ledger writes transactions.template_id and the bill_payments row from one input.
      bill: ['transactions.template_id', 'bill_payments.template_id', 'bill_payments.bill_month'],
      money: [
        'entries.account_id',
        'entries.amount_minor',
        'entries.currency',
        // Ruled O2: the book-currency figure (the owner's workspace currency is the book's, ruled O3), so a receiver
        // can post a line in another currency with ratesToBase taken from the pair.
        'entries.amount_base_minor',
        'entries.memo',
        'transactions.original_currency',
        'transactions.original_amount_minor',
      ],
      void: ['transactions.status'],
      // Its place within its day, moved there by hand (0067): written in place, never reposted, by apply.
      dayOrder: ['transactions.day_order'],
      // The amount as typed with cents (0068), beside the whole one: written in place when it is all that changed. Not
      // money: an older build ignores it, and every balance reads the lines.
      exactHundredths: ['transactions.exact_hundredths'],
    },
    linkColumns: [
      'transactions.id',
      'entries.id',
      'entries.transaction_id',
      'book_transactions.transaction_id',
      'book_transactions.book_id',
      'book_transaction_splits.transaction_id',
      'book_transaction_splits.book_id',
      'transaction_flags.transaction_id',
      'transaction_line_excluded.transaction_id',
      'bill_payments.transaction_id',
    ],
  },
];

/**
 * Columns of synced tables that never travel. Every column of a synced table is exactly one of: a key column, a field
 * above, a purchase's `linkColumns`, or listed here — the test holds the lists to the schema. `localOnInsert` columns
 * are listed here too.
 */
export const NEVER_SYNCED_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  books: ['workspace_id', 'kind', 'sort_order', 'created_at'],
  // number_last4 (0080), for_spending (0086) and card_tier (0087) and counted_from (0107) are a money account's; a category never has any.
  accounts: ['workspace_id', 'valuation_mode', 'created_at', 'number_last4', 'for_spending', 'card_tier', 'counted_from'],
  budgets: ['workspace_id', 'created_at', 'updated_at'],
  budget_overrides: ['workspace_id'],
  budget_frequencies: ['workspace_id'],
  budget_shares: ['workspace_id'],
  book_budget_settings: ['workspace_id', 'updated_at'],
  book_income_overrides: ['workspace_id'],
  expense_templates: ['workspace_id', 'created_at'],
  bill_windows: ['workspace_id'],
  bill_skips: ['workspace_id', 'created_at'],
  bill_pauses: ['workspace_id', 'created_at'],
  transactions: [
    'workspace_id',
    'source',
    'external_ref',
    'event_id',
    'replaces_transaction_id',
    'mcc',
    'card_id',
    'goal_id',
    'created_at',
  ],
  entries: ['workspace_id', 'fx_rate_to_base', 'spend_category_id'],
  category_needs: ['workspace_id'],
  category_colours: ['workspace_id'],
  book_transactions: ['workspace_id'],
  book_transaction_splits: ['workspace_id'],
  transaction_flags: ['workspace_id'],
  transaction_line_excluded: ['workspace_id'],
  bill_payments: ['workspace_id'],
  // book_id is this row's own scope, not a synced field: apply writes it locally on insert (migration 0056).
  book_members: ['book_id'],
  book_devices: ['book_id'],
  // Joint-net-worth's five synced tables (migration 0057): book_id is the group log's local book id, written locally
  // on insert like any other entity scoped by its book.
  nw_proposals: ['book_id'],
  nw_answers: ['book_id'],
  nw_items: ['book_id'],
  nw_pending: ['book_id'],
  member_transfers: ['book_id'],
  // transaction_id is the recorder's own live transfer, local only.
  shared_transfers: ['book_id', 'transaction_id'],
  // Shared events (migration 0069): book_id is the event book's local id, written on insert. shared_events is keyed
  // by it, so every one of its columns travels or is the key.
  event_people: ['book_id'],
  event_categories: ['book_id'],
  event_expenses: ['book_id'],
  event_expense_details: ['book_id'],
  event_settlements: ['book_id'],
  event_items_shared: ['book_id'],
  // Shared goals (migration 0109 and the goals' own tables): a goal's rank, standing amount and note stay on the phone.
  goals: ['workspace_id', 'rank', 'standing_monthly_minor', 'standing_note', 'created_at'],
  goal_stages: ['workspace_id'],
  goal_stage_terms: ['workspace_id'],
  goal_calculators: ['workspace_id'],
  goal_share_leaves: ['workspace_id'],
  goal_member_funding: ['workspace_id'],
  goal_member_moves: ['workspace_id'],
  goal_shares: ['book_id', 'workspace_id'],
};

export function entityOf(name: string): SharedEntity {
  const found = SHARED_ENTITIES.find((e) => e.entity === name);
  if (!found) throw new Error(`Unknown shared entity "${name}"`);
  return found;
}

/** The `Op.id` of a row: its key columns' values joined by `|`, in `keyColumns` order. */
export function buildOpId(entity: SharedEntity, key: Readonly<Record<string, string>>): string {
  return entity.keyColumns
    .map((column) => {
      const value = key[column];
      if (value === undefined) throw new Error(`${entity.entity}: key column ${column} missing`);
      if (value.includes(OP_ID_SEPARATOR)) throw new Error(`${entity.entity}: key ${column} contains "${OP_ID_SEPARATOR}"`);
      return value;
    })
    .join(OP_ID_SEPARATOR);
}

/** The key columns of an `Op.id`, the inverse of `buildOpId`. */
export function parseOpId(entity: SharedEntity, id: string): Record<string, string> {
  const parts = id.split(OP_ID_SEPARATOR);
  if (parts.length !== entity.keyColumns.length) throw new Error(`${entity.entity}: "${id}" is not a ${entity.keyColumns.length}-part id`);
  return Object.fromEntries(entity.keyColumns.map((column, i) => [column, parts[i]!]));
}
