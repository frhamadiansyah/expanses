/* Bills that repeat every few weeks (2026-11-25): a prepaid electricity token bought roughly every 3 weeks. No table
   changes. Such a bill is expense_templates.repeat = 'weeks' with repeat_every its gap in weeks (1 to 8) and
   repeat_month null, and each of its payments' bill_payments.bill_month is the day it was paid ('YYYY-MM-DD') where
   every other bill's is the month it settles ('YYYY-MM'). Both columns are TEXT/INTEGER with no CHECK, so every row
   written before reads exactly as it did.

   This version exists so a linked device on an older build (Link my devices, 0126) holds every change made from it
   until it updates, rather than reading a weekly bill as monthly and a payment's day as a month. A shared workspace's
   phones are held back by WEEKLY_BILLS_MIN_APP_VERSION instead (sync/events/version.ts). */
SELECT 1;
