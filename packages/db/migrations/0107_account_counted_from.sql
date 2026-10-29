-- "As of" for a money account opened at nothing: the day its balance is counted from.
--
-- An account opened with money has an opening entry, and its date is the day the balance starts. One opened at zero (a
-- wallet, cash) has no entry, so there was nowhere to keep the day; the app fell back to the day the account was
-- added. This keeps a day of its own, null until one is chosen: a purchase dated before it starts out as a "past"
-- purchase, one dated on or after it as an ordinary one. Nothing is recomputed when it changes; it moves no balance.
--
-- A setting of this device, read and written by name and never synced (see NEVER_SYNCED_COLUMNS), as card_tier (0087) is.
ALTER TABLE accounts ADD COLUMN counted_from TEXT;
