import {
  BookReadOnlyError,
  type BookSyncStatus,
  FrozenBookError,
  LastOwnerError,
  LeaveIncompleteError,
  type MemberSilence,
  type PurchasePayer,
  removedFromBook,
  type SharedBookMember,
  SharingError,
  SILENT_NOTE_DAYS,
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
  // A time Safari cannot parse is NaN: "an unknown time" is true, "Invalid Date" is not a sentence.
  if (!Number.isFinite(ms)) return 'an unknown time';
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
export const REMOVED_LINE = 'Removed from this workspace';

/** An ended share, in the switcher and on the status line: who stopped it, that you left, or that this device was removed. */
export function endedLine(ended: { byName: string | null; byYou: boolean; removed?: boolean }): string {
  if (ended.removed) return REMOVED_LINE;
  if (ended.byYou) return 'Left this workspace';
  return ended.byName ? `No longer shared by ${ended.byName}` : 'No longer shared';
}

/**
 * The status line (§11), from the engine's `bookSyncStatus`: "Up to date" · "3 changes waiting" · "Not synced since
 * Tue" · "Ask Dewi for a new invite to keep sharing" · "No longer shared by Fandri" · frozen. A run failing right now
 * says so at once, before the five minutes after which the engine calls the book stale.
 */
export function statusLineOf(status: BookSyncStatus, live: { failing: boolean; now: number }): string {
  // Never empty (the husband's Share row in the restore incident showed only "Sync now"): whatever the engine hands
  // back — an unknown state, a blank name, a time that does not parse — the row says something true.
  return statusLineOrNothing(status, live).trim() || `Sharing state: ${String((status as { state?: unknown }).state ?? 'not known')}`;
}

function statusLineOrNothing(status: BookSyncStatus, live: { failing: boolean; now: number }): string {
  switch (status.state) {
    case 'unshared':
      return endedLine({ ...status, byName: status.byName?.trim() || null, removed: status.reason === 'removed' });
    case 'needs_invite':
      return `Ask ${status.askName?.trim() || 'an owner'} for a new invite to keep sharing`;
    case 'frozen':
      return 'Frozen: no owner has a device here';
    case 'stale':
      return `Not synced since ${sinceWhen(Date.parse(status.since), live.now)}`;
    case 'up_to_date':
    case 'waiting': {
      if (live.failing) return status.syncedAt ? `Not synced since ${sinceWhen(Date.parse(status.syncedAt), live.now)}` : 'Not synced yet';
      if (status.state === 'waiting') return `${status.changes} ${status.changes === 1 ? 'change' : 'changes'} waiting`;
      return 'Up to date';
    }
    default:
      return '';
  }
}

/**
 * The Share page's status row before and around the engine's answer: still reading, the read failed, or no status at
 * all (no engine on this device, or no `shared_books` row) — each says so instead of "Checking…" for ever.
 */
export function shareStatusLine(input: { status: BookSyncStatus | null; pending: boolean; error: unknown; failing: boolean; now: number }): string {
  if (input.status) return statusLineOf(input.status, input);
  if (input.error) return 'Sync status could not be read';
  if (input.pending) return 'Checking…';
  return 'Sync status not known on this device yet';
}

/** Under the status row: when this device last finished a sync, from the run this session or the stored time. */
export function lastSyncedLine(ms: number | null, now: number): string {
  return ms === null ? 'Not synced on this device yet' : `Last synced ${syncedAgo(ms, now).replace(/^synced /, '')}`;
}

/** Under the status row after a failed run: the failure in words, short. */
export function lastFailedLine(error: unknown): string {
  const said = sayError(error);
  const message = said instanceof Error ? said.message : String(said);
  const short = message.length > 140 ? `${message.slice(0, 139)}…` : message;
  return `Last sync failed: ${short || 'no reason given'}`;
}

/** Before Leave: what leaving does, and what stays. */
export function leaveConfirm(bookName: string): string {
  return `Stops receiving ${bookName}, and the others stop seeing new changes from here. What is here stays, read-only.`;
}

/** Before Stop sharing: what stopping does to everyone. */
export function stopConfirm(bookName: string): string {
  return `${bookName} stops syncing for everyone. Each person keeps what they have, read-only on their devices; here it goes back to being its own, unshared copy.`;
}

/** The row that ends a dead share on this device alone (final review, C1). */
export const FORGET_ROW = 'Stop sharing on this device';

/** That row's confirm button (spec §8.1: once "Keep as my own copy"). */
export const KEEP_OWN_LABEL = 'Keep as own copy';

/**
 * Before that: what keeping the copy as your own does, and what it does not. The way back is true (recovery review,
 * N3): an owner's invite that links this device as you rejoins the share, and what you recorded meanwhile goes with it.
 */
export function forgetConfirm(bookName: string): string {
  return `${bookName} becomes its own workspace, with everything in it, and can be changed or shared again. Nobody else's copy is touched. To join the share again later, ask one of its owners for an invite that links this device to the same member again.`;
}

/**
 * Before Join moves this device's copy onto another share than the one it was on (recovery review, N1): a share made
 * again by one of its owners. `bookName` is the workspace's name here; `inviterName` is who sent the invite.
 */
export function replaceConfirm(bookName: string, inviterName: string): string {
  return `This replaces the sharing of ${bookName} on this device with ${inviterName}’s share. Existing rows stay and are merged.`;
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

/**
 * The payer a row in a shared book names on its second line (`payerLine`), or null when the row names what it was paid
 * with itself, by its digits, as any row in a private workspace does. That is a purchase this device's own member paid
 * from an account of their own here: the label their share recorded is only the account's full name, and the row
 * already knows the account. One someone else paid, or one posted here against a placeholder (from another of this
 * member's devices, or after a restore), keeps the label — as does every row while the accounts are not read yet.
 */
export function payerToShow(payer: PurchasePayer | null, tx: Parameters<typeof postedAgainstPlaceholder>[0], known: ReadonlySet<string>): PurchasePayer | null {
  if (!payer) return null;
  return payer.mine && known.size > 0 && !postedAgainstPlaceholder(tx, known) ? null : payer;
}

/** The currency refusal, word for word as §8.2 says it: the book's currency first, then this app's. */
export function currencyRefusal(bookCurrency: string, ownCurrency: string): string {
  return `This workspace keeps its money in ${bookCurrency}; this app's own accounts are kept in ${ownCurrency}. Sharing across currencies isn't supported yet.`;
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
  if (error instanceof LeaveIncompleteError) return new Error('No longer an owner, but leaving did not finish. Try again.');
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

/* ------------------------------------------------- sharing resilience (spec §4.4, §7, §8.1) */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** "12 Oct": the day a change was last heard, whatever the week. */
function dayMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/**
 * "No changes from Dewi since 12 Oct." once a member has made no change for `SILENT_NOTE_DAYS` (D-A10). It claims a
 * change, never a sync or a departure: silence is no edits, not a phone gone. Null before then, or when nothing was heard.
 */
export function silenceLine(s: Pick<MemberSilence, 'name' | 'lastChangeAt'> & Partial<MemberSilence>, nowMs: number): string | null {
  const last = s.lastChangeAt ? Date.parse(s.lastChangeAt) : Number.NaN;
  if (!Number.isFinite(last)) return null;
  if (Math.floor((nowMs - last) / DAY_MS) < SILENT_NOTE_DAYS) return null;
  return `No changes from ${s.name.trim() || 'the other side'} since ${dayMonth(last)}.`;
}

/**
 * The status's second line (D-A10): every other owner — or, with none, the only other member — quiet for a week, and
 * this phone synced within the hour, so the quiet is theirs. The newest of them is named. Null otherwise.
 */
export function shareSilenceLine(silences: readonly MemberSilence[], input: { syncedAt: number | null; nowMs: number }): string | null {
  if (input.syncedAt === null || input.nowMs - input.syncedAt > HOUR_MS) return null;
  const owners = silences.filter((s) => s.role === 'owner');
  const watched = owners.length > 0 ? owners : silences.length === 1 ? silences : [];
  if (watched.length === 0 || watched.some((s) => silenceLine(s, input.nowMs) === null)) return null;
  const newest = [...watched].sort((a, b) => Date.parse(b.lastChangeAt!) - Date.parse(a.lastChangeAt!))[0]!;
  return silenceLine(newest, input.nowMs);
}

/** A member row's second line (D-A10): "Last change 12 Oct", from the newest change heard from their devices. */
export function lastChangeLine(s: Pick<MemberSilence, 'lastChangeAt'> & Partial<MemberSilence>, nowMs: number): string {
  const last = s.lastChangeAt ? Date.parse(s.lastChangeAt) : Number.NaN;
  return Number.isFinite(last) ? `Last change ${sinceWhen(last, nowMs)}` : 'No change heard yet';
}

/**
 * Rows of the share set aside because another copy here holds them (D-A3, §4.4): named while that copy exists, then
 * "waiting" with Place them now. Null with none.
 */
export function heldLine(
  held: readonly { holderName: string | null; holderExists: boolean; holderSeparate?: boolean; holderActive?: boolean }[],
): string | null {
  if (held.length === 0) return null;
  const live = held.filter((row) => row.holderExists);
  if (live.length === 0) return 'Part of this share is waiting. Place it now.';
  const name = (row: { holderName: string | null }) => row.holderName?.trim() || 'another copy';
  // An old copy of this workspace holds them: the step is to delete it, in its own row's words (re-review m-5).
  const old = live.filter((row) => !row.holderSeparate);
  if (old.length > 0) {
    const names = [...new Set(old.map(name))];
    const how = old.some((row) => row.holderActive) ? 'Leave and delete' : 'Delete';
    return `Part of this share is held by ${nameList(names)} on this phone. ${how} ${names.length === 1 ? 'that copy' : 'those copies'} to bring it in.`;
  }
  // Only a separate workspace — Business beside Home — holds them (re-review N-2): it is never to be left or deleted
  // for this share's sake, so the line only says where they are.
  const separate = [...new Set(live.map(name))];
  const shared = live.some((row) => row.holderActive);
  return `Part of this share is also in ${nameList(separate)}${shared ? `, which ${separate.length === 1 ? 'is' : 'are'} still shared` : ''}; it stays there.`;
}

/** The action once nothing here holds them (§4.3). */
export const PLACE_LABEL = 'Place them now';
export const PLACE_TITLE = 'Place them now?';
export const PLACE_CONFIRM = 'The share is read again from its start, and the rows that were waiting come in. Rows already here stay as they are.';

/** After Place them now: how many came in, from the result. */
export function placedLine(done: { placed: number; stillHeld: number; needsAccount?: number }, where: string | null = null): string {
  const rows = (n: number) => `${n} ${n === 1 ? 'row' : 'rows'}`;
  const waiting = `${rows(done.stillHeld)} still ${done.stillHeld === 1 ? 'waits' : 'wait'}`;
  const base =
    done.placed === 0
      ? done.stillHeld === 0
        ? 'Nothing was waiting.'
        : `Nothing placed; ${waiting}.`
      : done.stillHeld === 0
        ? `${rows(done.placed)} placed.`
        : `${rows(done.placed)} placed; ${waiting}.`;
  // Own purchases that came in on no own account (A6: the recorded account was gone): said, short.
  const n = done.needsAccount ?? 0;
  return n > 0 ? `${base} ${needsAccountLine(n, where)}` : base;
}

/**
 * Own purchases that came back onto no own account (A6 `needsAccount`), and where to fix them (re-review m-4): "2
 * purchases need an account: open them in Home · joined today and choose the account paid from."
 */
export function needsAccountLine(n: number, where: string | null = null): string {
  const what = `${n} ${n === 1 ? 'purchase needs' : 'purchases need'} an account`;
  return `${what}: open ${n === 1 ? 'it' : 'them'} in ${where ?? 'the workspace'} and choose the account paid from.`;
}

/**
 * A share this phone held and lost (§6.2 `lost`, §7): Drop A cannot bring it back, so it promises nothing — the rows are
 * safe, and a fresh share needs the old one discarded first.
 */
export const LOST_LINE = (book: string) => `${book} lost its share on this phone. Records here are safe. To share it again, discard the old share first.`;
export const DISCARD_LABEL = 'Discard old share';
export const DISCARD_TITLE = 'Discard the old share?';
export function discardConfirm(book: string, joined = false): string {
  const before = joined ? `${book} was in a share on this phone before` : `${book} was shared from this phone before`;
  return `${before}, and that share cannot be brought back here in this update. Discarding it lets ${book} be shared again. Nothing in ${book} changes, and no other copy is touched.`;
}

/** Keep as own copy, asked (D-A11). */
export function keepOwnTitle(book: string): string {
  return `Keep ${book} as own copy?`;
}

/**
 * Before keeping a copy whose owners have made no change for two weeks (D-A11): this phone's copy leaves the share,
 * locally — the owners' phones are not told. `since` is the newest change heard from them.
 */
export function ownersGoneConfirm(book: string, owners: readonly string[], since: string | null): string {
  const who = nameList(owners.map((name) => name.trim() || 'the owner'));
  const last = since ? Date.parse(since) : Number.NaN;
  const quiet = Number.isFinite(last) ? `No changes from ${who} since ${dayMonth(last)}.` : `No changes from ${who} for two weeks.`;
  const told = owners.length === 1 ? `${who}'s phone is not told.` : 'Their phones are not told.';
  return `${quiet} This phone's copy of ${book} leaves the share: ${book} stops syncing on this phone and stays here with every row, editable. ${told} ${book} can be shared again later.`;
}

/**
 * Which copy a workspace is, where two of the same name sit on this phone (A8 review I-2): "Home · joined 3 Oct",
 * "Home · joined today", "Home · shared 1 Sept". The name alone when no share date is known.
 */
export function copyLabel(copy: { name: string; joined: boolean; sharedAt: string | null }, nowMs: number): string {
  const at = copy.sharedAt ? Date.parse(copy.sharedAt) : Number.NaN;
  if (!Number.isFinite(at)) return copy.name;
  const day = new Date(at).toDateString() === new Date(nowMs).toDateString() ? 'today' : dayMonth(at);
  return `${copy.name} · ${copy.joined ? 'joined' : 'shared'} ${day}`;
}

/**
 * Before joining beside another copy of the same workspace (D-A7), naming it: a warning, never a stop. The safe order
 * (A6 review) is join first, then delete the old copy — Leave and delete while it is still shared — then Place them
 * now; deleting first can count own purchases twice.
 */
export function otherCopyLine(copies: readonly { label: string; active: boolean }[]): string {
  const how = copies.some((copy) => copy.active) ? 'Leave and delete' : 'delete';
  const which = nameList(copies.map((copy) => copy.label));
  const one = copies.length === 1;
  return `${one ? 'Another copy' : 'Other copies'} of this workspace ${one ? 'is' : 'are'} on this phone: ${which}. Join first, then ${how} the old ${one ? 'copy' : 'copies'}; ${one ? 'its' : 'their'} rows come in with Place them now.`;
}

/** Which of two copies a delete sheet is on (A8 review I-2): this one, and what it is to the other. */
export function thisCopyLine(label: string): string {
  return `This is ${label}.`;
}
/** A copy whose rows a newer share here waits for: deleting it is the step. */
export function holdsForLine(newer: string): string {
  return `This copy holds rows of the newer share, ${newer}; deleting it lets them come in.`;
}
/** The newer share itself, waiting on an old copy: deleting this one is the wrong tap. */
export function isNewerLine(older: string): string {
  return `This is the newer share; the copy to delete is ${older}.`;
}

/** After Leave and delete (or Delete here only) left the share but the delete refused (A8 review I-1). */
export function leftNotDeletedLine(book: string, reason: string, how: 'left' | 'forgotten'): string {
  const first = how === 'left' ? 'Left the share.' : 'The share was forgotten on this phone.';
  return `${first} ${book} was not deleted: ${reason}`;
}

/** The text an invite is sent as: the link, then where the code is typed (an event's on Events, a workspace's on Add workspace). */
export function inviteText(kind: 'workspace' | 'event', inviterName: string, bookName: string, link: string, code: string): string {
  const where = kind === 'event' ? 'Join with a code on Events' : 'Add workspace › Join with a code';
  return `${inviterName} sent an invite to ${bookName}. Open ${link} — or choose ${where} in the app and enter ${code}`;
}
