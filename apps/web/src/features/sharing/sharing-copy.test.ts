import { describe, expect, it } from 'vitest';
import { BookReadOnlyError, FrozenBookError, LastOwnerError, LeaveIncompleteError, NotOwnerError, SharingError, SyncTransportError } from '@expanses/db';
import { currencyRefusal, endedLine, FORGET_ROW, forgetConfirm, FROZEN_NOTE, leaveConfirm, postedAgainstPlaceholder, READ_ONLY_NOTE, sayError, statusLineOf, stopConfirm, deviceName, ownerName, payerLine, preparing, sharedWith, sinceWhen, syncedAgo } from './sharing-copy';

const fandri = { memberId: 'f', name: 'Fandri', role: 'owner' as const };
const dewi = { memberId: 'd', name: 'Dewi', role: 'member' as const };
const budi = { memberId: 'b', name: 'Budi', role: 'member' as const };

// A Wednesday, mid-afternoon, local time.
const NOW = new Date(2026, 8, 30, 15, 0).getTime();

describe('the switcher subtitle', () => {
  it('names everyone else, as a list is read aloud', () => {
    expect(sharedWith([fandri, dewi], 'f')).toBe('Shared with Dewi');
    expect(sharedWith([fandri, dewi, budi], 'd')).toBe('Shared with Fandri and Budi');
    expect(sharedWith([fandri], 'f')).toBe('Shared, nobody has joined yet');
  });
});

describe('who to ask', () => {
  it('names another owner before this device’s own member', () => {
    expect(ownerName([fandri, { ...dewi, role: 'owner' }], 'f')).toBe('Dewi');
    expect(ownerName([fandri, dewi], 'f')).toBe('Fandri');
    expect(ownerName([dewi], 'd')).toBeNull();
  });
});

describe('when', () => {
  it('is a time today, a weekday this week, a date before that', () => {
    expect(sinceWhen(new Date(2026, 8, 30, 9, 5).getTime(), NOW)).toBe('09:05');
    expect(sinceWhen(new Date(2026, 8, 28, 9, 5).getTime(), NOW)).toBe('Mon');
    expect(sinceWhen(new Date(2026, 8, 12, 9, 5).getTime(), NOW)).toBe('12 Sept');
  });

  it('a device was synced minutes, hours or days ago', () => {
    expect(syncedAgo(null, NOW)).toBe('not synced yet');
    expect(syncedAgo(NOW - 20_000, NOW)).toBe('synced just now');
    expect(syncedAgo(NOW - 2 * 60_000, NOW)).toBe('synced 2 min ago');
    expect(syncedAgo(NOW - 3 * 3_600_000, NOW)).toBe('synced 3 h ago');
    expect(syncedAgo(new Date(2026, 8, 28, 9, 5).getTime(), NOW)).toBe('synced Mon');
  });
});

describe('a purchase in a shared book', () => {
  it('reads the payer’s label, and who paid when it was not you', () => {
    expect(payerLine({ paidBy: 'd', paidLabel: 'Visa ···· 1467', payerName: 'Dewi', mine: false })).toBe('Visa ···· 1467 · paid by Dewi');
    expect(payerLine({ paidBy: 'f', paidLabel: 'Current account', payerName: 'Fandri', mine: true })).toBe('Current account');
    expect(payerLine({ paidBy: 'd', paidLabel: '', payerName: 'Dewi', mine: false })).toBe('Paid by Dewi');
  });
});

describe('sharing across currencies', () => {
  it('is refused in §8.2’s own words', () => {
    expect(currencyRefusal('IDR', 'SGD')).toBe("This workspace keeps its money in IDR; this app keeps yours in SGD. Sharing across currencies isn't supported yet.");
  });
});

describe('device names and counts', () => {
  it('names the device from what it says it is', () => {
    expect(deviceName('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('iPhone');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Mobile/15E148')).toBe('iPad');
    expect(deviceName('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130')).toBe('Mac');
    expect(deviceName('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows PC');
    expect(deviceName('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile')).toBe('Android phone');
    expect(deviceName('curl/8')).toBe('This device');
  });

  it('prepares in grouped counts', () => {
    expect(preparing(1204, 3120)).toBe('Preparing 1,204 of 3,120');
  });
});

describe('what a failed share, join, link or remove says', () => {
  const said = (error: unknown) => (sayError(error) as Error).message;

  it('keeps the engine’s own sentence for a refusal it knows', () => {
    expect(said(new SharingError('NOT_OWNER', 'Only an owner can invite someone or link a device'))).toBe('Only an owner can invite someone or link a device');
  });

  it('words the relay’s answers for a person, never as a status code', () => {
    expect(said(new SyncTransportError(0, 'relay unreachable: Failed to fetch'))).toBe("Couldn't reach the sharing service. Check the connection and try again.");
    expect(said(new TypeError('Failed to fetch'))).toBe("Couldn't reach the sharing service. Check the connection and try again.");
    expect(said(new SyncTransportError(403, 'owner only'))).toBe('Only an owner of this workspace can do that.');
    expect(said(new SyncTransportError(410, 'gone'))).toBe('This workspace is no longer shared.');
  });

  it('passes anything else through as it came', () => {
    const odd = new Error('disk full');
    expect(sayError(odd)).toBe(odd);
  });
});

describe('a purchase posted against a placeholder here', () => {
  const known = new Set(['bank', 'groceries']);
  it('is one whose money side names an account this device does not list, known before any query about its payer', () => {
    const mine = { entries: [{ accountId: 'bank', accountKind: 'asset' }, { accountId: 'groceries', accountKind: 'expense' }] };
    const theirs = { entries: [{ accountId: 'placeholder', accountKind: 'asset' }, { accountId: 'groceries', accountKind: 'expense' }] };
    expect(postedAgainstPlaceholder(mine, known)).toBe(false);
    expect(postedAgainstPlaceholder(theirs, known)).toBe(true);
  });
  it('never judges a category line, and says nothing while the accounts are not read yet', () => {
    expect(postedAgainstPlaceholder({ entries: [{ accountId: 'new-category', accountKind: 'expense' }] }, known)).toBe(false);
    expect(postedAgainstPlaceholder({ entries: [{ accountId: 'placeholder', accountKind: 'asset' }] }, new Set())).toBe(false);
  });
});

describe('the status line from the engine’s status (§11, task 9b)', () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 30, h, m).toISOString();
  const line = (status: Parameters<typeof statusLineOf>[0], failing = false) => statusLineOf(status, { failing, now: NOW });

  it('says each state §11 lists, and frozen', () => {
    expect(line({ state: 'up_to_date', syncedAt: at(14) })).toBe('Up to date');
    expect(line({ state: 'waiting', changes: 3, syncedAt: at(14) })).toBe('3 changes waiting');
    expect(line({ state: 'waiting', changes: 1, syncedAt: null })).toBe('1 change waiting');
    expect(line({ state: 'stale', since: new Date(2026, 8, 29, 9, 30).toISOString(), changes: 0 })).toBe('Not synced since Tue');
    expect(line({ state: 'needs_invite', askName: 'Dewi' })).toBe('Ask Dewi for a new invite to keep sharing');
    expect(line({ state: 'needs_invite', askName: null })).toBe('Ask an owner for a new invite to keep sharing');
    expect(line({ state: 'unshared', byMemberId: 'f', byName: 'Fandri', byYou: false, reason: 'stopped' })).toBe('No longer shared by Fandri');
    expect(line({ state: 'unshared', byMemberId: 'd', byName: 'Dewi', byYou: true, reason: 'left' })).toBe('You left this workspace');
    expect(line({ state: 'unshared', byMemberId: null, byName: null, byYou: false, reason: 'stopped' })).toBe('No longer shared');
    expect(line({ state: 'unshared', byMemberId: null, byName: null, byYou: false, reason: 'removed' })).toBe('You were removed from this workspace');
    expect(line({ state: 'frozen', changes: 0, syncedAt: at(14) })).toBe('Frozen: no owner has a device here');
  });

  it('says a run that is failing right now, before the five minutes that make a book stale', () => {
    expect(line({ state: 'up_to_date', syncedAt: at(14, 58) }, true)).toBe('Not synced since 14:58');
    expect(line({ state: 'waiting', changes: 2, syncedAt: null }, true)).toBe('Not synced yet');
  });

  it('explains frozen and read-only in one line each', () => {
    expect(FROZEN_NOTE).toBe('Nobody can invite, remove a device or make an owner. Recording and syncing go on.');
    expect(READ_ONLY_NOTE).toBe('Kept here as it was, read-only: nothing can be added or changed.');
    expect(endedLine({ byName: 'Fandri', byYou: false })).toBe('No longer shared by Fandri');
    expect(endedLine({ byName: null, byYou: false, removed: true })).toBe('You were removed from this workspace');
  });

  it('asks before leaving and before stopping, saying what stays', () => {
    expect(leaveConfirm('Home')).toBe('You stop receiving Home, and the others stop seeing your new changes. What is here stays, read-only.');
    expect(stopConfirm('Home')).toBe('Home stops syncing for everyone. Each person keeps what they have, read-only on their devices; here it goes back to being yours alone.');
  });

  it('asks before keeping a dead share as your own copy, saying nobody else is touched (final review, C1)', () => {
    expect(FORGET_ROW).toBe('Stop sharing on this device');
    expect(forgetConfirm('Home')).toBe(
      'Home becomes a workspace of your own, with everything in it, and can be changed or shared again. Nobody else\'s copy is touched. To join the share again later, ask one of its owners for an invite that links this device as you.',
    );
  });
});

describe('what a sharing edge refusal says (task 9b)', () => {
  const said = (error: unknown) => (sayError(error) as Error).message;
  it('words each of the engine’s refusals', () => {
    expect(said(new LastOwnerError('anything'))).toBe('Make someone else owner first.');
    expect(said(new LeaveIncompleteError(new Error('x')))).toBe('You are no longer an owner, but leaving did not finish. Try again.');
    expect(said(new FrozenBookError())).toBe('Nobody can do that: no owner has a device in this workspace any more.');
    expect(said(new BookReadOnlyError('b'))).toBe('This workspace is no longer shared and is kept read-only. Nothing in it can be changed.');
    expect(said(new NotOwnerError('Only an owner can stop sharing'))).toBe('Only an owner can stop sharing');
  });
});
