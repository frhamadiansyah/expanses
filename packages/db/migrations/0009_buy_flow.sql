-- Buying from the transaction window: a goal on a transfer, a purchase category on a card line,
-- and monthly templates that move money instead of buying units.

-- The goal a tagged transfer funds. Ordinary payments never carry one: spent money leaves net worth.
ALTER TABLE transactions ADD COLUMN goal_id TEXT REFERENCES goals(id);

-- Category of a card purchase whose other side is an asset, so the points engine still sees card spend.
ALTER TABLE entries ADD COLUMN spend_category_id TEXT REFERENCES accounts(id);

-- 'buy' confirms units later; 'move' just parks money in a broker or savings account.
ALTER TABLE trade_templates ADD COLUMN kind TEXT NOT NULL DEFAULT 'buy' CHECK (kind IN ('buy', 'move'));
