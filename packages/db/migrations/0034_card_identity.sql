/* Who issued a card, what the product is called, and which physical cards run on it.

   A card account is the statement: one limit, one due date, one debt. The plastic is separate — a
   supplementary card shares its holder's statement and limit but has its own last four digits, and
   the point of recording those is to tell whose spending is whose on a bill that arrives as one.

   The issuer sits in a table of its own rather than on accounts: the ORM names every column it knows
   on every insert, and accounts is what a new workspace seeds, so a column there breaks any database
   still stopped at an older version. The account name is left exactly as it was — one field, typed by
   the owner — so nothing that reads an account by name has to change. */
CREATE TABLE card_identity (
  account_id TEXT PRIMARY KEY REFERENCES accounts(id),
  workspace_id TEXT NOT NULL,
  /* The bank as the catalogue spells it, so an entry can fill this in. It scopes the last four
     digits: two banks can both issue a card ending 1467, one bank cannot. */
  issuer TEXT
);

CREATE INDEX card_identity_workspace ON card_identity (workspace_id);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  /* The account whose statement this card spends on: a credit account, or a bank account for a debit card. */
  account_id TEXT NOT NULL REFERENCES accounts(id),
  /* Exactly four digits, or nothing when the owner would rather not record them. */
  last4 TEXT CHECK (last4 IS NULL OR (length(last4) = 4 AND last4 GLOB '[0-9][0-9][0-9][0-9]')),
  /* Whose card it is, for a statement that carries more than one. */
  holder_name TEXT,
  /* The card the account was opened with; supplementary cards are added after it. */
  is_primary INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX cards_account ON cards (workspace_id, account_id);

/* Which physical card a purchase was made on. Null on anything not made with a card, and on card
   purchases recorded before this existed. */
ALTER TABLE transactions ADD COLUMN card_id TEXT REFERENCES cards(id);
