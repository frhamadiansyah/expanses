/**
 * What was typed in a digital wallet's "Last 4 digits of phone": exactly four digits, or nothing at all — an empty
 * field removes any digits recorded. Anything else is refused in words, before the save is tried.
 */
export function readWalletLast4(typed: string): { ok: true; last4: string | null } | { ok: false; error: string } {
  const digits = typed.trim();
  if (digits === '') return { ok: true, last4: null };
  if (/^\d{4}$/.test(digits)) return { ok: true, last4: digits };
  return { ok: false, error: 'The last 4 digits of the phone number are four numbers, like 5521.' };
}
