/**
 * What was typed in a digital wallet's "Phone number" row: its last four digits, or nothing at all — an empty
 * field removes any digits recorded. A whole number pasted in ("0812-3456-5521", "+62 812…") keeps its last four, never
 * the carrier's prefix at its start; fewer than four digits is refused in words, before the save is tried.
 */
export function readWalletLast4(typed: string): { ok: true; last4: string | null } | { ok: false; error: string } {
  if (typed.trim() === '') return { ok: true, last4: null };
  const digits = typed.replace(/\D/g, '');
  if (digits.length >= 4) return { ok: true, last4: digits.slice(-4) };
  return { ok: false, error: 'The last 4 digits of the phone number are four numbers, like 5521.' };
}

/**
 * The same reading for a bank account's number: its last four digits, or nothing. A whole account number pasted in
 * keeps its last four; fewer than four is refused in words, before the save is tried.
 */
export function readAccountNumberLast4(typed: string): { ok: true; last4: string | null } | { ok: false; error: string } {
  if (typed.trim() === '') return { ok: true, last4: null };
  const digits = typed.replace(/\D/g, '');
  if (digits.length >= 4) return { ok: true, last4: digits.slice(-4) };
  return { ok: false, error: 'The last 4 digits of the account number are four numbers.' };
}

/**
 * What a last-4 row keeps of whatever reached its field: digits only, and of a longer number its last four. The field
 * stops at four as it is typed; a whole number pasted in comes through here instead, so it keeps its end ("…5521")
 * rather than the four a field's own length limit would keep, its start ("0812").
 */
export function keepLast4(typed: string): string {
  return typed.replace(/\D/g, '').slice(-4);
}

/**
 * The props a last-4 row's field takes: the number pad, four digits at most, and only digits, typed or pasted. The
 * paste is taken over because the browser cuts pasted text to the field's length from its start, before any
 * `onChange` could keep the end instead.
 */
export function last4Field(onDigits: (digits: string) => void) {
  return {
    inputMode: 'numeric' as const,
    maxLength: 4,
    autoComplete: 'off',
    onChange: (event: { target: { value: string } }) => onDigits(keepLast4(event.target.value)),
    onPaste: (event: { preventDefault: () => void; clipboardData: { getData: (format: string) => string } }) => {
      event.preventDefault();
      onDigits(keepLast4(event.clipboardData.getData('text')));
    },
  };
}
