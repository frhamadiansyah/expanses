-- A recurring bill that repeats once a year instead of every month. `repeat` is 'yearly' or null (every bill until now:
-- monthly); `repeat_month` is the month of the year it comes out, 1 to 12. Both are read and written by name, never
-- through the ORM table, for the reason in repos/bill-repeat.ts. They sync in a shared workspace as optional
-- `repeat` and `repeatMonth` fields: a build before this one skips them and would treat the bill as monthly.
ALTER TABLE expense_templates ADD COLUMN repeat TEXT;
ALTER TABLE expense_templates ADD COLUMN repeat_month INTEGER;
