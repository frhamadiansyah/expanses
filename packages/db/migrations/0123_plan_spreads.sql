/* A card instalment plan with no purchase, counted Each month, as it travels in a shared workspace (owner, 16 Nov 2026,
   design docs/sdd/card-instalments-c-no-purchase-family.md, option a). The plan itself (card_installments) never
   travels; this row is what another phone needs to count its instalments the same way, to the same rupiah: the plan's
   figures, its card's statement day, the day the card's records start (nothing billed before counts) and the category
   it counts in. The payer's phone keeps its own row in step with its plan (repos/plan-spreads.ts); another phone holds
   the rows it was sent. Synced as the plan_spread entity, scoped by the category's workspace.

   An older build knows no such entity and would stop its pull on one, so none goes into a shared book's log until every
   other phone there says PLAN_SPREAD_MIN_APP_VERSION (sync/capture.ts), and R9 sends them once they do. */

CREATE TABLE plan_spreads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  description TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  monthly_minor INTEGER NOT NULL,
  months INTEGER NOT NULL,
  first_billed_month TEXT NOT NULL,
  statement_day INTEGER NOT NULL,
  records_from TEXT,
  category_account_id TEXT NOT NULL
);

CREATE INDEX plan_spreads_category ON plan_spreads (category_account_id);
