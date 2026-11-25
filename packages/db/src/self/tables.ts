/*
 * Link my devices (spec 2026-11-19 §2.1): what the owner's other devices get. Every table of the schema is exactly one
 * of three classes, and the test (test/self/tables.test.ts) fails when a migration adds a table nobody has sorted.
 *
 * - `replicate`: the owner's data. Sent to every linked device, row by row, as it is. The default answer: a new table
 *   of the owner's data belongs here, and anything an app writes into it by itself must make the same row (same id) on
 *   every device that runs it (test/self/upkeep-twice.test.ts).
 * - `seat`: household sharing's bookkeeping. Written only by the one device that keeps a shared workspace in step with
 *   the household (the seat, §3.4), sent to the owner's other devices as read-only facts so one of them can take over.
 * - `device`: belongs to this install alone (keys sealed for it, what it still has to send, its own clock) — never sent,
 *   and taken out of a copy handed to a new device.
 * - `meta`: the self channel's own clocks, removals and merged ids. Never captured — every device's apply keeps them
 *   alike — and carried in the copy a new device starts from.
 *
 * `settings` is one table holding all three kinds of key: `settingsKeyClass` sorts each row.
 */

export type SelfClass = 'replicate' | 'seat' | 'device' | 'meta';

const DEVICE: readonly string[] = [
  'book_epoch_keys', // sealed for this device's own agreement key (household §5.5)
  'sync_outbox', // the seat's change-sets, stamped with its own clock
  'sync_skipped', // a diagnostic of this device's pulls; it has no primary key
  'schema_migrations', // every device runs its own migrations
  'self_state',
  'self_pending',
  'self_outbox',
  'self_notes',
  'self_group',
];

const META: readonly string[] = ['self_clocks', 'self_tombstones', 'self_aliases'];

const SEAT: readonly string[] = [
  'shared_books',
  'book_members',
  'book_devices',
  'book_member_accounts',
  'sync_lineage',
  'sync_lineage_last',
  'sync_cursor',
  'sync_field_clocks',
  'sync_kept_clocks',
  'sync_tombstones',
  'sync_authority',
  'sync_authority_devices',
  'sync_invites_used',
  // joint net worth: which group logs this device holds, what it sent, its share switches and joint marks (0057, 0097)
  'group_logs',
  'nw_group_books',
  'nw_item_map',
  'nw_sent',
  'nw_share_settings',
  'nw_joint_accounts',
  // transfers between partners as this device posted them (0057, 0059, 0100)
  'member_transfer_postings',
  'member_transfer_unposted',
  'member_transfer_accounts',
  // shared events as this device derived them (0069)
  'event_books',
  'event_postings',
  'event_category_accounts',
  'event_log_currency',
  // shared goals' history lines (0109)
  'goal_share_log',
];

const REPLICATE: readonly string[] = [
  'self_devices', // the Devices list: each device writes its own row
  'self_photos', // where each receipt photo's bytes can be fetched (Drop 4)
  'self_photo_have', // which devices hold each photo's file
  'self_standby', // the seat's invites making the other devices standby members of shared books (Drop 5)
  'accounts',
  'asset_acquired',
  'asset_profiles',
  'asset_sales',
  'audit_log',
  'bill_pauses',
  'bill_payments',
  'bill_skips',
  'bill_windows',
  'bond_coupons',
  'book_budget_settings',
  'book_categories',
  'book_category_sets',
  'book_income_overrides',
  'book_transaction_splits',
  'book_transactions',
  'books',
  'broker_fees',
  'budget_frequencies',
  'budget_income_overrides',
  'budget_overrides',
  'budget_settings',
  'budget_shares',
  'budgets',
  'calculator_inputs',
  'capture_settings',
  'capture_skipped',
  'capture_sources',
  'card_fee_refunds',
  'card_fee_waived_years',
  'card_fee_waivers',
  'card_identity',
  'card_installments',
  'card_part_payments',
  'card_postings',
  'card_settlements',
  'card_statement_settings',
  'card_terms',
  'cards',
  'catalog_category_choices',
  'category_colours',
  'category_mccs',
  'category_needs',
  'category_set_members',
  'category_sets',
  'cycle_actuals',
  'cycle_bonuses',
  'debt_profiles',
  'deposit_automation',
  'deposit_events',
  'deposit_terms',
  'draft_transactions',
  'earn_rules',
  'earns_into',
  'entries',
  'event_categories',
  'event_currency',
  'event_expense_details',
  'event_expenses',
  'event_item_currency',
  'event_item_purchases',
  'event_items',
  'event_items_shared',
  'event_people',
  'event_settlements',
  'events',
  'expense_templates',
  'fx_day_values',
  'fx_gain_loss',
  'fx_lot_uses',
  'fx_rates',
  'fx_recalc_pending',
  'fx_shortfalls',
  'goal_calculators',
  'goal_contributions',
  'goal_draws',
  'goal_due_months',
  'goal_dues',
  'goal_earmarks',
  'goal_member_funding',
  'goal_member_moves',
  'goal_share_leaves',
  'goal_shares',
  'goal_stage_terms',
  'goal_stages',
  'goals',
  'gold_price_choices',
  'holding_links',
  'income_sources',
  'investment_trades',
  'loan_items',
  'loan_rate_periods',
  'loan_terms',
  'member_transfers',
  'merchant_mccs',
  'nw_answers',
  'nw_items',
  'nw_pending',
  'nw_proposals',
  'plan_spreads',
  'point_entries',
  'point_programmes',
  'point_snapshots',
  'prices',
  'purchase_spreads',
  'redemption_options',
  'reward_programs',
  'securities',
  'security_price_choices',
  'security_prices',
  'settings',
  'shared_events',
  'shared_transfers',
  'sinking_fund_entries',
  'sinking_funds',
  'statement_checks',
  'statement_links',
  'tax_year_reports',
  'tax_year_rows',
  'trade_goal_parts',
  'trade_templates',
  'transaction_flags',
  'transaction_line_excluded',
  'transaction_photos',
  'transaction_point_actuals',
  'transactions',
  'transfer_partners',
  'valuations',
  'workspace_members',
  'workspaces',
];

function classes(): Readonly<Record<string, SelfClass>> {
  const out: Record<string, SelfClass> = {};
  for (const [kind, list] of [['device', DEVICE], ['meta', META], ['seat', SEAT], ['replicate', REPLICATE]] as const) {
    for (const table of list) {
      if (out[table]) throw new Error(`Table ${table} is sorted twice`);
      out[table] = kind;
    }
  }
  return out;
}

export const SELF_TABLES: Readonly<Record<string, SelfClass>> = classes();

/** Settings keys by prefix, first match wins. Anything not listed is the owner's and replicates. */
const SETTINGS_PREFIXES: readonly (readonly [string, SelfClass])[] = [
  // the seat's household bookkeeping, before the device's own `sync.` keys
  ['sync.seen.', 'seat'],
  ['sync.received.', 'seat'],
  ['sharing.', 'seat'],
  ['share.', 'seat'],
  ['nw.', 'seat'],
  ['goal.pending_summaries', 'seat'],
  ['goal.summary.', 'seat'],
  ['goal.moves.', 'seat'],
  ['shared-events.', 'seat'],
  ['repair.', 'seat'],
  // this install's own
  ['sync.', 'device'],
  ['last_backup_at', 'device'],
  ['icloud_backup', 'device'],
  ['fx.recalc_failures', 'device'],
  // the workspace open on this screen: a Mac may sit on Business while the phone is on Personal
  ['active_book:', 'device'],
];

export function settingsKeyClass(key: string): SelfClass {
  for (const [prefix, kind] of SETTINGS_PREFIXES) if (key.startsWith(prefix)) return kind;
  return 'replicate';
}

/** The settings key prefixes of one class, for SQL filters (`key LIKE prefix || '%'`), in match order. */
export function settingsPrefixes(): readonly (readonly [string, SelfClass])[] {
  return SETTINGS_PREFIXES;
}
