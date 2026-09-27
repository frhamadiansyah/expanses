import type { PurchasePayer, SharedBookMember, SharedBookState } from '@expanses/db';

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

export interface StatusInput {
  state: SharedBookState;
  members: readonly SharedBookMember[];
  me: string;
  /** Change-sets waiting in the outbox. */
  waiting: number;
  /** The last run that reached the relay, this session or before. */
  lastSyncedAt: number | null;
  failing: boolean;
  now: number;
}

/**
 * The status line (§11): "Up to date" · "3 changes waiting" · "Not synced since Tue" · "Ask Dewi for a new invite to
 * keep sharing" · "No longer shared by Fandri".
 */
export function statusLine(input: StatusInput): string {
  const owner = ownerName(input.members, input.me);
  if (input.state === 'unshared') return owner ? `No longer shared by ${owner}` : 'No longer shared';
  if (input.state === 'needs_invite') return owner ? `Ask ${owner} for a new invite to keep sharing` : 'Ask for a new invite to keep sharing';
  if (input.failing) return input.lastSyncedAt === null ? 'Not synced yet' : `Not synced since ${sinceWhen(input.lastSyncedAt, input.now)}`;
  if (input.waiting > 0) return `${input.waiting} ${input.waiting === 1 ? 'change' : 'changes'} waiting`;
  if (input.lastSyncedAt === null) return 'Not synced yet';
  return 'Up to date';
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
