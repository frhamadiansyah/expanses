-- A goal is counted in a currency of its own: a hajj or tuition goal in SAR or USD, a holiday in JPY. Its stage targets,
-- standing monthly amount and everything the plan works out are in that currency's minor units.
--
-- Every goal so far was in its workspace's base currency, so that is what existing rows are given and nothing about them
-- changes. A reader treats a missing value as the base currency too, so a goal written by a build that did not know
-- the column (null) still reads as it always did.
ALTER TABLE goals ADD COLUMN currency TEXT;
UPDATE goals SET currency = (SELECT base_currency FROM workspaces WHERE workspaces.id = goals.workspace_id);
