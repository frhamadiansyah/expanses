import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Shared goals' tables (0109, spec 2026-11-10-shared-goals-design §7.2). No column is added to any existing table. */

export const goalShares = sqliteTable(
  'goal_shares',
  {
    goalId: text('goal_id').primaryKey(),
    bookId: text('book_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    /** Member id of the sharer; written once. */
    sharedBy: text('shared_by').notNull(),
    state: text('state', { enum: ['on', 'off', 'deleted'] }).notNull(),
    stateOn: text('state_on').notNull(),
    /** +1 each time sharing is turned on again. */
    round: integer('round').notNull().default(1),
  },
  (t) => [index('goal_shares_book').on(t.bookId, t.state)],
);

export const goalShareLeaves = sqliteTable(
  'goal_share_leaves',
  {
    goalId: text('goal_id').notNull(),
    memberId: text('member_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    round: integer('round').notNull(),
    leftOn: text('left_on').notNull(),
  },
  (t) => [primaryKey({ columns: [t.goalId, t.memberId] })],
);

export const goalMemberFunding = sqliteTable(
  'goal_member_funding',
  {
    goalId: text('goal_id').notNull(),
    memberId: text('member_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    /** JSON: [{ ref, name, kind: 'earmark' | 'tagged', amountMinor: number | null, risk: 'low' | 'medium' | 'high' | null }]. */
    linesJson: text('lines_json').notNull(),
    plannedMonthlyMinor: integer('planned_monthly_minor').notNull().default(0),
    asOf: text('as_of').notNull(),
  },
  (t) => [primaryKey({ columns: [t.goalId, t.memberId] })],
);

export const goalMemberMoves = sqliteTable(
  'goal_member_moves',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    memberId: text('member_id').notNull(),
    kind: text('kind', { enum: ['set-aside', 'taken-back', 'borrowed', 'spent', 'moved'] }).notNull(),
    occurredOn: text('occurred_on').notNull(),
    /** Signed, in `currency` (display only). */
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    text: text('text').notNull(),
    stageId: text('stage_id'),
  },
  (t) => [index('goal_member_moves_goal').on(t.goalId, t.occurredOn)],
);

/** Local only, never synced. */
export const goalShareLog = sqliteTable('goal_share_log', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  goalId: text('goal_id').notNull(),
  kind: text('kind', { enum: ['shared', 'stopped', 'left', 'unshared', 'ended'] }).notNull(),
  memberName: text('member_name').notNull(),
  amountMinor: integer('amount_minor'),
  /** On a private copy's 'unshared' line: the shared goal's id. */
  copiedFrom: text('copied_from'),
  occurredOn: text('occurred_on').notNull(),
});
