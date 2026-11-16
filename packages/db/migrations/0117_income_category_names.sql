/* Three built-in income categories get clearer names (owner, 16 Nov 2026): Salary is now "Salary, wage, or pay", Bonus
   "Bonus and benefits", and Gifts Received "Gifts, awards, and grants". Keys stay, so card rules, capture and every
   transaction keep their category.

   Only a row that still carries its key and the very name the app gave it is renamed: one the owner renamed, even by
   a letter's case, keeps its own name, and an unkeyed row is the owner's own. Every book is covered, a joined one too:
   each phone runs this on its own copy and both end with the same name, so nothing is sent and no sync clock moves. A
   phone on an older build keeps the old name until it updates; a rename either phone makes by hand still travels and
   wins as any later write does.

   "Side business and selling", the new default, is not made here: the app adds it on open (ensureCategoryKeys), under
   an id worked out from the book, so two phones adding it to one book make one row.

   A book whose share is down keeps each field's clock with the value it had (sync_kept_clocks), and sharing it again
   sends a field whose value changed meanwhile at a fresh clock. The kept name moves with the row first, so the rename
   is not taken for a change made while the share was down and sent over a partner's own name for it. */
UPDATE sync_kept_clocks SET value_json = '"Salary, wage, or pay"' WHERE entity = 'category' AND field = 'name' AND value_json = '"Salary"'
  AND id IN (SELECT id FROM accounts WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.salary' AND name = 'Salary');
UPDATE sync_kept_clocks SET value_json = '"Bonus and benefits"' WHERE entity = 'category' AND field = 'name' AND value_json = '"Bonus"'
  AND id IN (SELECT id FROM accounts WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.bonus' AND name = 'Bonus');
UPDATE sync_kept_clocks SET value_json = '"Gifts, awards, and grants"' WHERE entity = 'category' AND field = 'name' AND value_json = '"Gifts Received"'
  AND id IN (SELECT id FROM accounts WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.gifts' AND name = 'Gifts Received');
UPDATE accounts SET name = 'Salary, wage, or pay' WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.salary' AND name = 'Salary';
UPDATE accounts SET name = 'Bonus and benefits' WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.bonus' AND name = 'Bonus';
UPDATE accounts SET name = 'Gifts, awards, and grants' WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.gifts' AND name = 'Gifts Received';
