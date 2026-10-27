-- A bill that comes out every few months (2 to 11) rather than every month or once a year. `repeat` is then 'months',
-- `repeat_month` is the month its first occurrence falls in, and `repeat_every` is the gap in months. Null for every
-- bill until now (monthly) and for yearly bills (repeat = 'yearly'). Read and written by name (repos/bill-repeat.ts). It syncs
-- in a shared workspace as an optional `repeatEvery` field: a build before this one skips it and reads the bill as monthly.
ALTER TABLE expense_templates ADD COLUMN repeat_every INTEGER;
