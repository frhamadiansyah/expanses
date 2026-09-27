import {
  BookReadOnlyError,
  type BookSyncStatus,
  FrozenBookError,
  LastOwnerError,
  LeaveIncompleteError,
  type PurchasePayer,
  removedFromBook,
  type SharedBookMember,
  SharingError,
  SyncTransportError,
} from '@expanses/db';

/*
 * What the sharing screens say (household sharing spec §11), worked out away from the screens so every sentence can
 * be tested without a browser. Country-neutral: nothing here names a bank, a currency or a place.
 */

/** "Dewi" · "Dewi and Budi" · "Dewi, Budi and Sari". */
export function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The switcher's subtitle for a shared book: who else is in it. */
export function sharedWith(members: readonly SharedBookMember[], me: string): string {
  const others = members.filter((member) => member.memberId !== me).map((member) => member.name);
  return others.length === 0 ? 'Shared, nobody has joined yet' : `Shared with ${nameList(others)}`;
}

/** The owner to name in "Ask … for a new invite" and "No longer shared by …": another owner first, else any. */
export function ownerName(members: readonly SharedBookMember[], me: string): string | null {
  const owners = members.filter((member) => member.role === 'owner');
  return (owners.find((member) => member.memberId !== me) ?? owners[0])?.name ?? null;
}

/** "14:05" today, "Tue" within the week, "12 Sep" before that. */
export function sinceWhen(ms: number, now: number): string {
  const then = new Date(ms);
  const today = new Date(now);
  if (then.toDateString() === today.toDateString()) {
    return then.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }
  if (now - ms < 6 * 24 * 60 * 60 * 1000) return then.toLocaleDateString('en-GB', { weekday: 'short' });
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** One-line explanations under the status line. */
export const FROZEN_NOTE = 'Nobody can invite, remove a device or make an owner. Recording and syncing go on.';
export const READ_ONLY_NOTE = 'Kept here as it was, read-only: nothing can be added or changed.';

/** The status line once an owner removed this device (§8.4, final review I2). */
export const REMOVED_LINE = 'You were removed from this workspace';

/** An ended share, in the switcher and on the status line: who stopped it, that you left, or that this device was removed. */
export function endedLine(ended: { byName: string | null; byYou: boolean; removed?: boolean }): string {
  if (ended.removed) return REMOVED_LINE;
  if (ended.byYou) return 'You left this workspace';
  return ended.byName ? `No longer shared by ${ended.byName}` : 'No longer shared';
}

/**
 * The status line (§11), from the engine's `bookSyncStatus`: "Up to date" · "3 changes waiting" · "Not synced since
 * Tue" · "Ask Dewi for a new invite to keep sharing" · "No longer shared by Fandri" · frozen. A run failing right now
 * says so at once, before the five minutes after which the engine calls the book stale.
 */
export function statusLineOf(status: BookSyncStatus, live: { failing: boolean; now: number }): string {
  switch (status.state) {
    case 'unshared':
      return endedLine({ ...status, removed: status.reason === 'removed' });
    case 'needs_invite':
      return `Ask ${status.askName ?? 'an owner'} for a new invite to keep sharing`;
    case 'frozen':
      return 'Frozen: no owner has a device here';
    case 'stale':
      return `Not synced since ${sinceWhen(Date.parse(status.since), live.now)}`;
    default: {
      if (live.failing) return status.syncedAt ? `Not synced since ${sinceWhen(Date.parse(status.syncedAt), live.now)}` : 'Not synced yet';
      if (status.state === 'waiting') return `${status.changes} ${status.changes === 1 ? 'change' : 'changes'} waiting`;
      return 'Up to date';
    }
  }
}

/** Before Leave: what leaving does, and what stays. */
export function leaveConfirm(bookName: string): string {
  return `You stop receiving ${bookName}, and the others stop seeing your new changes. What is here stays, read-only.`;
}

/** Before Stop sharing: what stopping does to everyone. */
export function stopConfirm(bookName: string): string {
  return `${bookName} stops syncing for everyone. Each person keeps what they have, read-only on their devices; here it goes back to being yours alone.`;
}

/** The row that ends a dead share on this device alone (final review, C1). */
export const FORGET_ROW = 'Stop sharing on this device';

/** Before that: what keeping the copy as your own does, and what it does not. */
export function forgetConfirm(bookName: string): string {
  return `${bookName} becomes a workspace of your own, with everything in it, and can be changed or shared again. Nobody else's copy is touched. To join it again later, you will need a new invite.`;
}

/** Under a device: "synced just now", "synced 2 min ago", "synced 3 h ago", "synced Tue". */
export function syncedAgo(ms: number | null, now: number): string {
  if (ms === null) return 'not synced yet';
  const minutes = Math.floor(Math.max(0, now - ms) / 60_000);
  if (minutes < 1) return 'synced just now';
  if (minutes < 60) return `synced ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `synced ${hours} h ago`;
  return `synced ${sinceWhen(ms, now)}`;
}

/** A purchase's second line in a shared book (§11): the payer's label, and who paid when it was not you. */
export function payerLine(payer: PurchasePayer): string {
  const label = payer.paidLabel;
  if (payer.mine) return label;
  const who = payer.payerName ?? 'someone else';
  return label ? `${label} · paid by ${who}` : `Paid by ${who}`;
}

/** The currency refusal, word for word as §8.2 says it: the book's currency first, then this app's. */
export function currencyRefusal(bookCurrency: string, ownCurrency: string): string {
  return `This workspace keeps its money in ${bookCurrency}; this app keeps yours in ${ownCurrency}. Sharing across currencies isn't supported yet.`;
}

/** What this device is called in the members list, from what the browser or the shell says it is. */
export function deviceName(userAgent: string, platform = ''): string {
  if (/iPhone/.test(userAgent)) return 'iPhone';
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile/.test(userAgent))) return 'iPad';
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
  if (/Macintosh|Mac OS X/.test(userAgent) || /Mac/.test(platform)) return 'Mac';
  if (/Windows/.test(userAgent)) return 'Windows PC';
  if (/CrOS/.test(userAgent)) return 'Chromebook';
  if (/Linux/.test(userAgent)) return 'Linux computer';
  return 'This device';
}

/** "1,204": the counts in "Preparing N of M", grouped the way the rest of the app groups a count. */
export function preparing(done: number, total: number): string {
  const f = (n: number) => n.toLocaleString('en-US');
  return `Preparing ${f(done)} of ${f(total)}`;
}

const UNREACHABLE = "Couldn't reach the sharing service. Check the connection and try again.";

/**
 * What a failed share, join, link or remove says to a person: the engine's own sentence for a refusal it knows, the
 * relay's answers in words rather than status codes, and anything else as it came.
 */
export function sayError(error: unknown): unknown {
  if (error instanceof LastOwnerError) return new Error('Make someone else owner first.');
  if (error instanceof LeaveIncompleteError) return new Error('You are no longer an owner, but leaving did not finish. Try again.');
  if (error instanceof FrozenBookError) return new Error('Nobody can do that: no owner has a device in this workspace any more.');
  if (error instanceof BookReadOnlyError) return new Error('This workspace is no longer shared and is kept read-only. Nothing in it can be changed.');
  if (error instanceof SharingError) return error;
  if (error instanceof SyncTransportError) {
    if (error.status === 0) return new Error(UNREACHABLE);
    if (removedFromBook(error)) return new Error(`${REMOVED_LINE}.`);
    if (error.status === 403) return new Error('Only an owner of this workspace can do that.');
    if (error.status === 410) return new Error('This workspace is no longer shared.');
    return error;
  }
  if (error instanceof Error && /relay unreachable|Failed to fetch|NetworkError|Load failed/i.test(error.message)) return new Error(UNREACHABLE);
  return error;
}

/**
 * Whether a transaction is posted here against a placeholder (spec §4.4): its money side names an asset or liability
 * account that this device's own list leaves out. Known from the transaction and the accounts alone, so a list never
 * waits on the payers query to keep another member's purchase out of the quick editor, a table cell or a re-file.
 * An empty list is "not read yet", not "every account is someone else's".
 */
export function postedAgainstPlaceholder(tx: { entries: readonly { accountId: string; accountKind: string }[] }, known: ReadonlySet<string>): boolean {
  if (known.size === 0) return false;
  return tx.entries.some((entry) => (entry.accountKind === 'asset' || entry.accountKind === 'liability') && !known.has(entry.accountId));
}
