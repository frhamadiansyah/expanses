export type { SqlExecutor, SqlMethod } from './executor';
export { createDatabase, replacementsOf, type Database, type Db } from './database';
export {
  databaseVersion,
  futureVersions,
  LATEST_VERSION,
  migrate,
  MIGRATIONS,
  type Migration,
  type MigrateOptions,
  pendingMigrations,
} from './migrations';
export * as schema from './schema';
export { inBook, ownerScope, type WorkspaceContext } from './context';
export { DEFAULT_CATEGORIES, SYSTEM_ACCOUNTS, type SystemAccountKey } from './seed';
export * from './repos/workspaces';
export * from './repos/accounts';
export * from './repos/data-counts';
export * from './repos/account-delete';
export * from './repos/category-delete';
export * from './repos/cash-accounts';
export * from './repos/pockets';
export * from './repos/pocketed-identity';
export * from './repos/deposit-terms';
export * from './repos/deposit-automation';
export * from './repos/categories';
export * from './repos/category-start';
export { uncategorisedCategory, uncategorisedIdOf, uncategorisedTransactionIds } from './repos/uncategorised';
export * from './repos/category-looks';
export * as categoryColoursSchema from './schema-category-colours';
export * from './repos/mcc';
export * from './repos/point-actuals';
export * from './repos/ledger';
export * from './repos/adjust-balance';
export * from './repos/money-in';
export * from './repos/integrity';
export * from './repos/fx';
export * from './repos/fx-tables';
export * from './repos/fx-gain-loss';
export * from './repos/fx-costs';
export * from './repos/fx-reads';
export * from './repos/fx-pending';
export * from './repos/reports';
export * as pointsSchema from './schema-points';
export * from './repos/points';
export * from './repos/card-fee';
export * from './repos/imports';
export * from './repos/catalog';
export * as assetsSchema from './schema-assets';
export * from './repos/assets';
export * from './repos/trades';
export * from './repos/fund-switch';
export * from './repos/base-costs';
export * from './repos/prices';
export * from './repos/listed-prices';
export * from './repos/broker-fees';
export * from './repos/asset-acquired';
export * from './repos/open-asset';
export * from './repos/asset-values';
export * from './repos/asset-sales';
export * as securitiesSchema from './schema-securities';
export * from './repos/securities';
export * from './repos/idle-cash';
export * from './repos/trade-templates';
export * from './repos/flows';
export * as goalsSchema from './schema-goals';
export * as goalSharingSchema from './schema-goal-sharing';
export * from './repos/goals';
export * from './repos/goal-funding';
export * from './repos/goal-transfers';
export * from './repos/goal-dues';
export { BalancesChangedError } from './repos/goal-due-link';
export * from './repos/set-aside-tx';
export * from './repos/set-aside';
export * from './repos/convert';
export * as debtsSchema from './schema-debts';
export * from './repos/debts';
export * from './repos/people';
export * as loansSchema from './schema-loans';
export * from './repos/loans';
export * from './repos/installments';
export * from './repos/instalment-spending';
export * as taxSchema from './schema-tax';
export * as recurringSchema from './schema-recurring';
export * as eventsSchema from './schema-events';
export * as businessSchema from './schema-business';
export * from './repos/tax-reports';
export * from './repos/tax-inputs';
export * as budgetSchema from './schema-budget';
export * from './repos/budgets';
export * from './repos/budget-settings';
export * from './repos/budget-sheet';
export * from './repos/goal-contributions';
export * from './repos/goal-calculators';
export * from './repos/calculator-inputs';
export * from './repos/debt-plan';
export * from './repos/point-ledger';
export * from './repos/programmes';
export * from './repos/coretax-income';
export * from './repos/business-income';
export * from './repos/kmk-rates';
export * from './repos/expense-templates';
export * from './repos/activity';
export * from './repos/card-fee-waiver';
export * from './repos/sinking-actions';
export * from './repos/sinking-funds';
export * from './repos/sinking-views';
export * from './repos/event-scope';
export * from './repos/events';
export * from './repos/event-mode';
export * from './repos/event-items';
export * from './repos/event-currency';
export * from './repos/shared-event-records';
export * from './repos/shared-event-postings';
export * from './repos/shared-event-writes';
export * from './repos/shared-event-reads';
export * from './repos/shared-event-plan';
export * from './repos/shared-event-moves';
export { eventTransferOf, removeTransferFromSharedEvent, standingTransaction, TRIP_TRANSFERS_MIN_APP_VERSION, type SharedEventTransferView } from './repos/shared-event-transfers';
export { listSharedTransfers, type SharedTransferRow } from './repos/shared-transfers';
export * as categorySetsSchema from './schema-category-sets';
export * from './repos/category-sets';
export * as draftsSchema from './schema-drafts';
export * as captureSchema from './schema-capture';
export * from './repos/drafts';
export * from './repos/entry';
// Capture: where captures come from and what each source learned, the matcher that keeps one payment to one draft,
// and the pipeline that turns what the phone handed over into the queue.
export * from './capture/sources';
export * from './capture/learn';
export * from './capture/match';
export * from './capture/ingest';
export * from './capture/skipped';
export * from './capture/reread';
export * from './repos/statements';
export * as statementsSchema from './schema-statements';
export * from './repos/statement-check';
export * as cardsSchema from './schema-cards';
export * from './repos/cards';
export * as booksSchema from './schema-books';
export * from './repos/books';
export * from './repos/book-delete';
export { eraseBookTx, keepInPersonalTx, keptByRecordsTx, ownPurchasesOfTx, ownPurchasesTx, ownRecordsMessage, wasEverShared, wasEverSharedTx } from './repos/book-erase';
export * from './repos/book-currency';
export { billTablesExist } from './repos/bill-months';
export * as extrasSchema from './schema-extras';
export * from './repos/transaction-extras';
export * as healthSchema from './schema-health';
export * from './repos/health-tables';
export * from './repos/share-tables';
export * from './repos/category-needs';
export * from './repos/essential-split';
export * as sharingSchema from './schema-sharing';
// Household sharing: the HTTP transport to the relay and its request signer (spec §9)
export { DEFAULT_RELAY_URL, RelayTransport, type RelayTransportOptions } from './sync/relay-transport';
export { ecdsaRequestSigner, type RequestSigner } from './sync/relay-signing';
export { isBookShared, type MemberPayer, memberPayerAccounts, notPlaceholder, sharingTablesExist } from './sync/placeholder';
export {
  FrozenBookError,
  LeaveIncompleteError,
  NotOwnerError,
  RECORD_EVERY_MS,
  REPLAY_POINT_KEY,
  SEEN_WRITE_MS,
  STALE_AFTER_MS,
  SyncEngine,
  type BookSyncStatus,
  type CreatedInvite,
  type EndedReason,
  type JoinInput,
  type PreviewedInvite,
  type ShareInput,
  type ShareRecordFinding,
  type SyncEngineOptions,
  type SyncOnceResult,
} from './sync/engine';
export { BookReadOnlyError, LastOwnerError, MemberNameError, SyncNotReadyError } from './sync/capture';
export {
  deviceKeysOf,
  exportDeviceJwks,
  generateDevice,
  generateKeyPairs,
  importDeviceJwks,
  MemoryKeyStore,
  publicJwk,
  requestSignerOf,
  type DeviceJwks,
  type DeviceKeys,
  type KeyStore,
} from './sync/keys';
export { inviteLink, parseInviteCode, JOIN_LINK_PREFIX, InviteCodeError } from './sync/invite';
// The share record kept beside the device keys, outside the database (sharing resilience §6.1).
export { MemoryShareRecordStore, parseShareRecord, storableShareRecord, type ShareRecord, type ShareRecordStore } from './sync/share-records';
export { deviceIdOf } from './sync/relay-signing';
export { MEMBER_NAME_MAX, SharingError, type SharingErrorCode } from './sync/seed';
export { type PullResult } from './sync/apply';
export { eventTagRefusalTx, tagDroppedText } from './repos/shared-workspace-rows';
export { BILL_LINKS_EVERYWHERE, dismissRepairNotice, repairNotices, runSharedBookRepairs, type RepairNotice, type RepairNoticeRow, type RepairReport } from './sync/repairs';
export * from './repos/sharing';
// Shared goals (§8.6): the app-version gate and the workspaces a goal can be shared into.
export { SHARED_GOALS_MIN_APP_VERSION } from './sync/goals/version';
export { resendGoalSummaries } from './sync/goals/summaries';
export {
  goalShareOf,
  goalSharesOf,
  goalShareTargets,
  leaveSharedGoal,
  markGoalDeletedTx,
  privateCopyOf,
  shareGoal,
  stopSharingGoal,
  type GoalShareTarget,
  type GoalShareView,
} from './repos/goal-sharing';
export { removedFromBook, SyncTransportError, type LogEntry, type SequencedEntry, type SyncTransport } from './sync/types';
// The in-memory relay, for the app's own tests of its sync wiring (it is the reference the real relay matches).
export { MemoryTransport } from './sync/memory-transport';
// Joint net worth (spec §9): the app-version gate every device's book_devices row carries.
export { meetsMinVersion, NET_WORTH_MIN_APP_VERSION } from './sync/net-worth/version';
// Joint net worth (spec §6, §8.1): the group's proposals and answers, and what each person shares of their own items.
export { type NetWorthGroupView } from './sync/net-worth/proposals';
// `markReviewedTx` and `sendAllowance` stay internal (the summaries' send gate): only Share records a review.
export {
  activeNetWorthGroup,
  confirmReview,
  departedMembers,
  getShareSetting,
  groupDissolved,
  groupStateOf,
  NetWorthError,
  pendingCounts,
  pendingHidden,
  proposalOf,
  refreshPendingCount,
  reviewedFor,
  reviewItems,
  setShareSetting,
  clearJointAccounts,
  getJointAccount,
  jointAccountIds,
  type NetWorthMarks,
  netWorthMarks,
  setNetWorthMarks,
  storedJointAccount,
  setJointAccount,
  type ActiveNetWorthGroup,
  type NetWorthErrorCode,
  type ReviewItem,
  type ShareSetting,
} from './repos/net-worth-sharing';
// Joint net worth (spec §5.2, §9, task 6): summaries — compute, send, receive — and the dirty mark a repository sets
// when it changes an account's value or profile outside the ledger doors (a share setting, say).
export { computeItemSummary, itemIdOf, ownSentAccountIds, receivedItems, sendSummariesTx } from './sync/net-worth/summaries';
export { ringPicks, setOwnRing } from './sync/net-worth/rings';
export { markAccountDirtyTx } from './sync/capture';
// The one list of what is shared with a household: whom it was already offered for, at set-up.
export { markShareListAsked, seedShareListAsked, shareListAskedFor } from './repos/share-list';
// Joint net worth §5.3, §7.1 (task 7): Paid with the other's shared item.
export { paidFromAccount, paidWithItems, PAYABLE_SUBTYPES, type PaidWithItem } from './sync/net-worth/paid-from';
export type { PaidFrom } from './sync/capture';
// Joint net worth §7.2 (task 8): transfers between partners, recorded once in the group log, posted on each party's phone.
export {
  editMemberTransfer,
  itemTransfers,
  memberTransfersOf,
  memberTransferUnposted,
  recordMemberTransfer,
  voidMemberTransfer,
  type ItemTransfer,
  type MemberTransferInput,
  type MemberTransferPatch,
  type MemberTransferSide,
  type UnpostedReason,
} from './sync/net-worth/transfers';
// Joint net worth (spec §8.3, task 9): the Household purchases of a period, with the shared item each was paid from.
export { jointAccountRows, jointRowNote, restoreJointRow, type JointRow } from './repos/joint-account-rows';
export { householdPurchases, type HouseholdPurchase } from './repos/household-purchases';
// Joint tax report (joint-net-worth §8.4, task 10): the report's inputs, with a joint group's received rows.
export { type JointReport, reportInputsFor } from './repos/joint-tax';
export { MONTH_START_MIN_APP_VERSION, phonesBehindMonthStart } from './sync/month-start';
export { NEEDS_THIRD_MARK_MIN_APP_VERSION, SHARED_EVENTS_MIN_APP_VERSION, TRIP_SWITCHES_MIN_APP_VERSION, meetsVersion } from './sync/events/version';
export type { EventInviteDetails } from './sync/invite';
export type { ShareEventInput, JoinEventInput } from './sync/events/event-log';
// Delete this copy: a shared event this phone's person is no longer in, taken off this phone alone.
export { ACTIVE_COPY_MESSAGE, deleteEventCopy, type EventCopyPlan, planEventCopyDelete, WAITING_COPY_MESSAGE } from './sync/events/event-copy';
// Sharing resilience §4.2 (D-A3): the rows of a share another copy on this phone holds, set aside until it is gone.
export { heldElsewhereOf, HELD_PREFIX, type HeldRow } from './sync/held';
export * from './repos/bond-coupons';
