-- A card's credit limit can be known before its billing and due dates are. The days were NOT NULL, so a limit typed on
-- the New card form with no dates had nowhere to live; SQLite cannot drop NOT NULL in place, so the table is rebuilt
-- with the two days optional (still 1 to 31 when given) and every row copied as it is. A row with no days is a limit
-- alone: the app treats it as a card with no billing cycle yet.
CREATE TABLE card_terms_new (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  credit_limit_minor INTEGER,
  statement_day INTEGER CHECK (statement_day IS NULL OR statement_day BETWEEN 1 AND 31),
  due_day INTEGER CHECK (due_day IS NULL OR due_day BETWEEN 1 AND 31),
  annual_fee_minor INTEGER,
  annual_fee_on TEXT CHECK (annual_fee_on IS NULL OR annual_fee_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  annual_fee_waived_year INTEGER
);

INSERT INTO card_terms_new (account_id, workspace_id, credit_limit_minor, statement_day, due_day, annual_fee_minor, annual_fee_on, annual_fee_waived_year)
SELECT account_id, workspace_id, credit_limit_minor, statement_day, due_day, annual_fee_minor, annual_fee_on, annual_fee_waived_year FROM card_terms;

DROP TABLE card_terms;
ALTER TABLE card_terms_new RENAME TO card_terms;
