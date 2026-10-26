-- A recurring bill's own currency: a life insurance bill in SGD paid from a rupiah account. Null (every bill until now)
-- means the bill follows the account that pays it, as before. The column is read and written by name, never through the
-- ORM table, for the reason in repos/bill-currency.ts. It syncs in a shared workspace as an optional `currency` field.
ALTER TABLE expense_templates ADD COLUMN currency TEXT;
