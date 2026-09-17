/* A book copies another book's categories keeping their system key, so card earning rules still recognise them
   in the new book too (0042's book_categories). That means two categories in the same workspace can now share a
   system key, one per book — breaking 0001's assumption that system_key was unique per workspace. That
   assumption only needs to hold for the handful of system equity accounts (opening_balance, currency_exchange)
   the index was built for, so it is narrowed to exclude categories (income/expense accounts). */
DROP INDEX accounts_system_key;
CREATE UNIQUE INDEX accounts_system_key ON accounts (workspace_id, system_key)
  WHERE system_key IS NOT NULL AND kind NOT IN ('income', 'expense');
