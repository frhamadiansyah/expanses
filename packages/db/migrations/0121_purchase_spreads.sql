/* A purchase spread each month by its card instalment plan, as it came from the payer's phone in a shared workspace
   (card instalments C, sync; docs/sdd/card-instalments-c-sync.md). The plan itself never travels: the payer's card is not
   on the other phone. What travels is the purchase's `spread` field — what the other phone needs to work the instalment
   lines out with the same function, to the same rupiah — kept here against the lineage's head, and carried to a
   replacement when the purchase is reposted, as card_installments.transaction_id is. Written only by apply.

   An older build took a `spread` field's clock and dropped the value (it knows no such field). Those clocks are dropped
   here, so the updated phone takes the field again when the payer's phone resends it (sync/repairs.ts, R8). */

CREATE TABLE purchase_spreads (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  months INTEGER NOT NULL,
  first_billed_month TEXT NOT NULL,
  total_minor INTEGER NOT NULL,
  monthly_minor INTEGER NOT NULL,
  statement_day INTEGER NOT NULL,
  whole_base_minor INTEGER NOT NULL
);

DELETE FROM sync_field_clocks WHERE entity = 'purchase' AND field = 'spread';
