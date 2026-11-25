/* Budget C (2026-11-25): a budget typed the way it repeats — a day, a week, every few weeks — watched by the month.
   A month's budget is the amount as typed × how many times it comes up in that month: every day, every Monday, or
   every date N weeks apart (core/budget/repeat.ts). A day and a week were already kept here (0053); this adds, for a
   week, how many weeks apart (NULL: every week) and the day every few weeks is counted from.

   budgets.amount_minor goes on holding the average month (a few weeks: a week's average divided by their number), so
   every reader that does not count a month's days reads what it always did. Two nullable columns, so every row written
   before reads exactly as it did.

   This version exists so a linked device on an older build (Link my devices, 0126) holds every change made from it
   until it updates, rather than reading a budget every 3 weeks as every week. A shared workspace's phones are held
   back by BUDGET_REPEAT_MIN_APP_VERSION instead (sync/events/version.ts). */
ALTER TABLE budget_frequencies ADD COLUMN every_weeks INTEGER CHECK (every_weeks IS NULL OR (every_weeks BETWEEN 1 AND 8));
ALTER TABLE budget_frequencies ADD COLUMN starts_on TEXT;
