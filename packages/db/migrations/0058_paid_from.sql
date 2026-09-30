-- Joint net worth §5.3: a purchase paid from a group member's shared item. `paid_by` stays who paid; these name whose
-- item the money side is on (owner member id, opaque item id), or NULL for the payer's own, unshared account, as before.
ALTER TABLE sync_lineage ADD COLUMN paid_from_owner TEXT;
ALTER TABLE sync_lineage ADD COLUMN paid_from_item TEXT;
