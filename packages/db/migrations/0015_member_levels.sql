-- A catalogue entry can publish member levels: a standing with the bank that changes what the card earns
-- or what a point converts to, such as a Jenius Club level set by average balance.
--
-- The level belongs to the holder, not the card, so the entry carries every level and the program records
-- which one was applied. NULL means the entry publishes no levels, which is every entry bundled before now.
ALTER TABLE reward_programs ADD COLUMN catalog_member_level TEXT;
