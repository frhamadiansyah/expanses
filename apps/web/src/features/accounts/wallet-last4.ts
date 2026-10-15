/**
 * What was typed in a digital wallet's "Last 4 digits of phone": its last four digits, or nothing at all — an empty
 * field removes any digits recorded. A whole number pasted in ("0812-3456-5521", "+62 812…") keeps its last four, never
 * the carrier's prefix at its start; fewer than four digits is refused in words, before the save is tried.
 */
export function readWalletLast4(typed: string): { ok: true; last4: string | null } | { ok: false; error: string } {
  if (typed.trim() === '') return { ok: true, last4: null };
  const digits = typed.replace(/\D/g, '');
  if (digits.length >= 4) return { ok: true, last4: digits.slice(-4) };
  return { ok: false, error: 'The last 4 digits of the phone number are four numbers, like 5521.' };
}
