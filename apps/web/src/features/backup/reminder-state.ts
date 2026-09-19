import type { BackupSnooze } from './backupState';

/**
 * The reminder state that lives on the device or in the page rather than in the user's data.
 *
 * Both halves are deliberately outside the database: a "Not now" is about this screen on this device, so
 * it must not travel inside a backup file, and a dismissed card is about this session only. They live
 * together here so the banner and the card above it can read the same thing — two components disagreeing
 * about whether a reminder has been answered is how a reminder goes quiet for good.
 */

/** Where a "Not now" on the standing backup reminder is remembered. The e2e fixture reads the same key. */
export const SNOOZE_KEY = 'expanses.backup-reminder.snoozed';

/** The "Not now" this device is holding, or null. A stored value this build cannot read counts as none. */
export function readSnooze(): BackupSnooze | null {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BackupSnooze>;
    return typeof parsed?.until === 'string' && typeof parsed.urgency === 'string' ? { until: parsed.until, urgency: parsed.urgency } : null;
  } catch {
    return null;
  }
}

/*
 * Whether the card above the page has been put away, shared across the whole page.
 *
 * The standing backup reminder stands down while that card is up, so that the two never stack. If the
 * dismissal stayed inside the card, dismissing it without exporting would silence the 7/14/30-day ladder
 * for the rest of the session — on a phone left in a pocket for a fortnight, that is the whole of the
 * thirty-day guarantee, gone to one tap. So the card publishes its dismissal and the banner subscribes.
 *
 * It is page-lifetime state on purpose: a reload is a new open, with a fresh answer about what happened
 * on the way in, and the card is entitled to say it again.
 */
let dismissed = false;
const listeners = new Set<() => void>();

export function updateCardDismissed(): boolean {
  return dismissed;
}

export function dismissUpdateCard(): void {
  if (dismissed) return;
  dismissed = true;
  for (const listener of [...listeners]) listener();
}

export function subscribeToUpdateCard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Puts the page-lifetime flag back the way a fresh load has it. Only a test needs this. */
export function resetUpdateCardDismissal(): void {
  dismissed = false;
}
