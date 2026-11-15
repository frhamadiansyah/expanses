/* Three built-in income categories get clearer names (owner, 16 Nov 2026): Salary is now "Salary, wage, or pay", Bonus
   "Bonus and benefits", and Gifts Received "Gifts, awards, and grants". Keys stay, so card rules, capture and every
   transaction keep their category.

   Only a row that still carries its key and the very name the app gave it is renamed: one the owner renamed, even by
   a letter's case, keeps its own name, and an unkeyed row is the owner's own. Every book is covered, a joined one too:
   each phone runs this on its own copy and both end with the same name, so nothing is sent and no sync clock moves. A
   phone on an older build keeps the old name until it updates; a rename either phone makes by hand still travels and
   wins as any later write does.

   "Side business and selling", the new default, is not made here: the app adds it on open (ensureCategoryKeys), under
   an id worked out from the book, so two phones adding it to one book make one row. */
UPDATE accounts SET name = 'Salary, wage, or pay' WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.salary' AND name = 'Salary';
UPDATE accounts SET name = 'Bonus and benefits' WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.bonus' AND name = 'Bonus';
UPDATE accounts SET name = 'Gifts, awards, and grants' WHERE subtype = 'category' AND kind = 'income' AND system_key = 'income.gifts' AND name = 'Gifts Received';
