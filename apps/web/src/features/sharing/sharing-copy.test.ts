import { describe, expect, it } from 'vitest';
import { BookReadOnlyError, FrozenBookError, LastOwnerError, LeaveIncompleteError, NotOwnerError, SharingError, SyncTransportError } from '@expanses/db';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stringLiterals } from '../../lib/string-literals';
import { DISCARD_LABEL, discardConfirm, heldLine, KEEP_OWN_LABEL, keepOwnTitle, lastChangeLine, LOST_LINE, otherCopyLine, copyLabel, thisCopyLine, holdsForLine, isNewerLine, leftNotDeletedLine, ownersGoneConfirm, PLACE_LABEL, placedLine, shareSilenceLine, silenceLine } from './sharing-copy';
import { currencyRefusal, inviteText, endedLine, lastFailedLine, lastSyncedLine, shareStatusLine, FORGET_ROW, forgetConfirm, replaceConfirm, FROZEN_NOTE, leaveConfirm, postedAgainstPlaceholder, READ_ONLY_NOTE, sayError, statusLineOf, stopConfirm, deviceName, ownerName, payerLine, preparing, sharedWith, sinceWhen, syncedAgo } from './sharing-copy';

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
    expect(payerLine({ paidBy: 'd', paidLabel: 'Visa ···· 1467', payerName: 'Dewi', mine: false, paidFrom: null })).toBe('Visa ···· 1467 · paid by Dewi');
    expect(payerLine({ paidBy: 'f', paidLabel: 'Current account', payerName: 'Fandri', mine: true, paidFrom: null })).toBe('Current account');
    expect(payerLine({ paidBy: 'd', paidLabel: '', payerName: 'Dewi', mine: false, paidFrom: null })).toBe('Paid by Dewi');
  });
});

describe('sharing across currencies', () => {
  it('is refused in §8.2’s own words', () => {
    expect(currencyRefusal('IDR', 'SGD')).toBe("This workspace keeps its money in IDR; this app's own accounts are kept in SGD. Sharing across currencies isn't supported yet.");
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
    expect(line({ state: 'unshared', byMemberId: 'd', byName: 'Dewi', byYou: true, reason: 'left' })).toBe('Left this workspace');
    expect(line({ state: 'unshared', byMemberId: null, byName: null, byYou: false, reason: 'stopped' })).toBe('No longer shared');
    expect(line({ state: 'unshared', byMemberId: null, byName: null, byYou: false, reason: 'removed' })).toBe('Removed from this workspace');
    expect(line({ state: 'frozen', changes: 0, syncedAt: at(14) })).toBe('Frozen: no owner has a device here');
  });

  it('says a run that is failing right now, before the five minutes that make a book stale', () => {
    expect(line({ state: 'up_to_date', syncedAt: at(14, 58) }, true)).toBe('Not synced since 14:58');
    expect(line({ state: 'waiting', changes: 2, syncedAt: null }, true)).toBe('Not synced yet');
  });

  it('is never empty, for every state, failing or not, whatever the names and times hold', () => {
    const states: Parameters<typeof statusLineOf>[0][] = [
      { state: 'up_to_date', syncedAt: null },
      { state: 'up_to_date', syncedAt: '2026-11-11 08:00:00' },
      { state: 'waiting', changes: 0, syncedAt: 'not a time' },
      { state: 'stale', since: 'not a time', changes: 2 },
      { state: 'stale', since: at(9), changes: 0 },
      { state: 'needs_invite', askName: '' },
      { state: 'needs_invite', askName: '  ' },
      { state: 'unshared', byMemberId: 'x', byName: '', byYou: false, reason: 'stopped' },
      { state: 'unshared', byMemberId: 'x', byName: null, byYou: true, reason: 'left' },
      { state: 'unshared', byMemberId: null, byName: null, byYou: false, reason: 'removed' },
      { state: 'frozen', changes: 1, syncedAt: null },
      { state: 'something new' } as unknown as Parameters<typeof statusLineOf>[0],
    ];
    for (const status of states) {
      for (const failing of [false, true]) {
        const said = line(status, failing);
        expect(said.trim().length, JSON.stringify({ status, failing })).toBeGreaterThan(0);
        expect(said).not.toMatch(/Invalid Date|NaN|undefined|null|\byou\b/i);
      }
    }
    expect(line({ state: 'needs_invite', askName: ' ' })).toBe('Ask an owner for a new invite to keep sharing');
    expect(line({ state: 'stale', since: 'not a time', changes: 0 })).toBe('Not synced since an unknown time');
    expect(line({ state: 'something new' } as unknown as Parameters<typeof statusLineOf>[0])).toBe('Sharing state: something new');
  });

  it('says something before and around the engine’s answer, never nothing', () => {
    const around = (input: Partial<Parameters<typeof shareStatusLine>[0]>) => shareStatusLine({ status: null, pending: false, error: null, failing: false, now: NOW, ...input });
    expect(around({ pending: true })).toBe('Checking…');
    expect(around({ error: new Error('x') })).toBe('Sync status could not be read');
    expect(around({})).toBe('Sync status not known on this device yet');
    expect(around({ status: { state: 'up_to_date', syncedAt: null } })).toBe('Up to date');
  });

  it('says under the row when this device last synced, and what the last failure was', () => {
    expect(lastSyncedLine(null, NOW)).toBe('Not synced on this device yet');
    expect(lastSyncedLine(NOW - 20_000, NOW)).toBe('Last synced just now');
    expect(lastSyncedLine(NOW - 5 * 60_000, NOW)).toBe('Last synced 5 min ago');
    expect(lastFailedLine(new SyncTransportError(503, 'unavailable'))).toBe('Last sync failed: unavailable');
    expect(lastFailedLine(new SyncTransportError(0, 'relay unreachable'))).toBe("Last sync failed: Couldn't reach the sharing service. Check the connection and try again.");
    expect(lastFailedLine(new Error(''))).toBe('Last sync failed: no reason given');
    expect(lastFailedLine(new Error('e'.repeat(300))).length).toBeLessThanOrEqual(160);
  });

  it('explains frozen and read-only in one line each', () => {
    expect(FROZEN_NOTE).toBe('Nobody can invite, remove a device or make an owner. Recording and syncing go on.');
    expect(READ_ONLY_NOTE).toBe('Kept here as it was, read-only: nothing can be added or changed.');
    expect(endedLine({ byName: 'Fandri', byYou: false })).toBe('No longer shared by Fandri');
    expect(endedLine({ byName: null, byYou: false, removed: true })).toBe('Removed from this workspace');
  });

  it('asks before leaving and before stopping, saying what stays', () => {
    expect(leaveConfirm('Home')).toBe('Stops receiving Home, and the others stop seeing new changes from here. What is here stays, read-only.');
    expect(stopConfirm('Home')).toBe('Home stops syncing for everyone. Each person keeps what they have, read-only on their devices; here it goes back to being its own, unshared copy.');
  });

  it('asks before keeping a dead share as your own copy, saying nobody else is touched (final review, C1)', () => {
    expect(FORGET_ROW).toBe('Stop sharing on this device');
    expect(forgetConfirm('Home')).toBe(
      'Home becomes its own workspace, with everything in it, and can be changed or shared again. Nobody else\'s copy is touched. To join the share again later, ask one of its owners for an invite that links this device to the same member again.',
    );
  });
});

describe('before a join moves this copy onto another share (recovery review, N1)', () => {
  it('names the workspace here and whose share takes its place, and that the rows stay', () => {
    expect(replaceConfirm('Home', 'Fandri')).toBe('This replaces the sharing of Home on this device with Fandri’s share. Existing rows stay and are merged.');
  });
});

describe('what a sharing edge refusal says (task 9b)', () => {
  const said = (error: unknown) => (sayError(error) as Error).message;
  it('words each of the engine’s refusals', () => {
    expect(said(new LastOwnerError('anything'))).toBe('Make someone else owner first.');
    expect(said(new LeaveIncompleteError(new Error('x')))).toBe('No longer an owner, but leaving did not finish. Try again.');
    expect(said(new FrozenBookError())).toBe('Nobody can do that: no owner has a device in this workspace any more.');
    expect(said(new BookReadOnlyError('b'))).toBe('This workspace is no longer shared and is kept read-only. Nothing in it can be changed.');
    expect(said(new NotOwnerError('Only an owner can stop sharing'))).toBe('Only an owner can stop sharing');
  });
});

describe('sharing resilience: what the Share page says (spec §4.4, §7, §8.1)', () => {
  // 12 Oct 2026 at noon, local time; "now" is a whole number of days later.
  const LAST = new Date(2026, 9, 12, 12, 0).getTime();
  const DAY = 86_400_000;
  const dewiQuiet = (days: number) => ({ memberId: 'd', name: 'Dewi', role: 'owner' as const, lastChangeAt: new Date(LAST).toISOString(), silentDays: days });

  it('names a quiet member from the seventh day on, and claims only a change', () => {
    expect(silenceLine(dewiQuiet(6), LAST + 6 * DAY)).toBeNull();
    expect(silenceLine(dewiQuiet(7), LAST + 7 * DAY)).toBe('No changes from Dewi since 12 Oct.');
    expect(silenceLine({ ...dewiQuiet(0), lastChangeAt: null, silentDays: null }, LAST + 30 * DAY)).toBeNull();
    expect(silenceLine(dewiQuiet(40), LAST + 40 * DAY)).not.toMatch(/gone|left|offline/i);
  });

  it('puts the quiet line on the status only when every owner is quiet and this phone synced in the last hour', () => {
    const now = LAST + 9 * DAY;
    const fresh = { syncedAt: now - 10 * 60_000, nowMs: now };
    expect(shareSilenceLine([dewiQuiet(9)], fresh)).toBe('No changes from Dewi since 12 Oct.');
    expect(shareSilenceLine([dewiQuiet(9)], { syncedAt: now - 2 * 3_600_000, nowMs: now })).toBeNull();
    expect(shareSilenceLine([dewiQuiet(9)], { syncedAt: null, nowMs: now })).toBeNull();
    // Another owner heard from yesterday: the share is not quiet.
    const budi = { memberId: 'b', name: 'Budi', role: 'owner' as const, lastChangeAt: new Date(now - DAY).toISOString(), silentDays: 1 };
    expect(shareSilenceLine([dewiQuiet(9), budi], fresh)).toBeNull();
    // No other owner: the only other member counts; two members and no owner, nobody to name.
    const member = { ...dewiQuiet(9), role: 'member' as const };
    expect(shareSilenceLine([member], fresh)).toBe('No changes from Dewi since 12 Oct.');
    expect(shareSilenceLine([member, { ...member, memberId: 'x', name: 'Sari' }], fresh)).toBeNull();
  });

  it('gives every other member a last change, or says none was heard', () => {
    expect(lastChangeLine(dewiQuiet(9), LAST + 9 * DAY)).toBe('Last change 12 Oct');
    expect(lastChangeLine({ ...dewiQuiet(0), lastChangeAt: null, silentDays: null }, LAST)).toBe('No change heard yet');
  });

  it('says part of the share is held by another copy here, or waiting once that copy is gone', () => {
    expect(heldLine([])).toBeNull();
    expect(heldLine([{ holderName: 'Home (old)', holderExists: true }, { holderName: 'Home (old)', holderExists: true }])).toBe(
      'Part of this share is held by Home (old) on this phone. Delete that copy to bring it in.',
    );
    expect(heldLine([{ holderName: 'Home (old)', holderExists: true }, { holderName: null, holderExists: false }])).toBe(
      'Part of this share is held by Home (old) on this phone. Delete that copy to bring it in.',
    );
    expect(heldLine([{ holderName: null, holderExists: true }])).toBe('Part of this share is held by another copy on this phone. Delete that copy to bring it in.');
    expect(heldLine([{ holderName: 'A', holderExists: true }, { holderName: 'B', holderExists: true }])).toBe(
      'Part of this share is held by A and B on this phone. Delete those copies to bring it in.',
    );
    expect(heldLine([{ holderName: null, holderExists: false }])).toBe('Part of this share is waiting. Place it now.');
    // An old copy still shared is left and deleted, in its row's own words (re-review m-5).
    expect(heldLine([{ holderName: 'Home · joined 3 Oct', holderExists: true, holderActive: true }])).toBe(
      'Part of this share is held by Home · joined 3 Oct on this phone. Leave and delete that copy to bring it in.',
    );
    // A separate workspace is never told to leave or delete for this share (re-review N-2).
    const separate = heldLine([{ holderName: 'Business · joined 2 Oct', holderExists: true, holderSeparate: true, holderActive: true }]);
    expect(separate).toBe('Part of this share is also in Business · joined 2 Oct, which is still shared; it stays there.');
    expect(separate).not.toMatch(/Delete|Leave/);
    expect(heldLine([{ holderName: 'Business', holderExists: true, holderSeparate: true }])).toBe('Part of this share is also in Business; it stays there.');
    // An old copy and a separate one: the old copy's step is the one said.
    expect(
      heldLine([
        { holderName: 'Home · joined 3 Oct', holderExists: true },
        { holderName: 'Business', holderExists: true, holderSeparate: true, holderActive: true },
      ]),
    ).toBe('Part of this share is held by Home · joined 3 Oct on this phone. Delete that copy to bring it in.');
    expect(PLACE_LABEL).toBe('Place them now');
    expect(placedLine({ placed: 3, stillHeld: 0 })).toBe('3 rows placed.');
    expect(placedLine({ placed: 1, stillHeld: 0 })).toBe('1 row placed.');
    expect(placedLine({ placed: 0, stillHeld: 0 })).toBe('Nothing was waiting.');
    expect(placedLine({ placed: 0, stillHeld: 2 })).toBe('Nothing placed; 2 rows still wait.');
    expect(placedLine({ placed: 3, stillHeld: 1 })).toBe('3 rows placed; 1 row still waits.');
    expect(placedLine({ placed: 3, stillHeld: 0, needsAccount: 2 }, 'Home · joined today')).toBe(
      '3 rows placed. 2 purchases need an account: open them in Home · joined today and choose the account paid from.',
    );
    expect(placedLine({ placed: 3, stillHeld: 0, needsAccount: 1 })).toBe('3 rows placed. 1 purchase needs an account: open it in the workspace and choose the account paid from.');
    expect(placedLine({ placed: 3, stillHeld: 0, needsAccount: 0 })).toBe('3 rows placed.');
  });

  it('says a lost share keeps the records here and promises no reconnection in this update', () => {
    expect(LOST_LINE('Home')).toBe('Home lost its share on this phone. Records here are safe. To share it again, discard the old share first.');
    expect(LOST_LINE('Home')).not.toMatch(/reconnect/i);
    expect(DISCARD_LABEL).toBe('Discard old share');
    expect(discardConfirm('Home', true)).toBe(
      'Home was in a share on this phone before, and that share cannot be brought back here in this update. Discarding it lets Home be shared again. Nothing in Home changes, and no other copy is touched.',
    );
    expect(discardConfirm('Home')).toBe(
      'Home was shared from this phone before, and that share cannot be brought back here in this update. Discarding it lets Home be shared again. Nothing in Home changes, and no other copy is touched.',
    );
  });

  it('keeps a copy as own once the owners went quiet, naming what is known', () => {
    expect(KEEP_OWN_LABEL).toBe('Keep as own copy');
    expect(keepOwnTitle('Home')).toBe('Keep Home as own copy?');
    expect(ownersGoneConfirm('Home', ['Dewi'], new Date(LAST).toISOString())).toBe(
      "No changes from Dewi since 12 Oct. This phone's copy of Home leaves the share: Home stops syncing on this phone and stays here with every row, editable. Dewi's phone is not told. Home can be shared again later.",
    );
    expect(ownersGoneConfirm('Home', ['Dewi', 'Budi'], null)).toBe(
      "No changes from Dewi and Budi for two weeks. This phone's copy of Home leaves the share: Home stops syncing on this phone and stays here with every row, editable. Their phones are not told. Home can be shared again later.",
    );
  });

  it('warns before joining beside another copy, naming it, in the safe order and the row’s own words (D-A7, review I-2, M-1)', () => {
    expect(otherCopyLine([{ label: 'Home · joined 3 Oct', active: true }])).toBe(
      'Another copy of this workspace is on this phone: Home · joined 3 Oct. Join first, then Leave and delete the old copy; its rows come in with Place them now.',
    );
    expect(otherCopyLine([{ label: 'Home · joined 3 Oct', active: false }, { label: 'Home · joined 9 Oct', active: false }])).toBe(
      'Other copies of this workspace are on this phone: Home · joined 3 Oct and Home · joined 9 Oct. Join first, then delete the old copies; their rows come in with Place them now.',
    );
  });

  it('tells two copies of one name apart by when they were joined or shared (review I-2)', () => {
    const now = new Date(2026, 10, 11, 15, 0).getTime();
    expect(copyLabel({ name: 'Home', joined: true, sharedAt: new Date(2026, 9, 3, 9, 0).toISOString() }, now)).toBe('Home · joined 3 Oct');
    expect(copyLabel({ name: 'Home', joined: true, sharedAt: new Date(2026, 10, 11, 9, 0).toISOString() }, now)).toBe('Home · joined today');
    expect(copyLabel({ name: 'Home', joined: false, sharedAt: new Date(2026, 9, 3, 9, 0).toISOString() }, now)).toBe('Home · shared 3 Oct');
    expect(copyLabel({ name: 'Home', joined: true, sharedAt: null }, now)).toBe('Home');
    expect(thisCopyLine('Home · joined 3 Oct')).toBe('This is Home · joined 3 Oct.');
    expect(holdsForLine('Home · joined today')).toBe('This copy holds rows of the newer share, Home · joined today; deleting it lets them come in.');
    expect(isNewerLine('Home · joined 3 Oct')).toBe('This is the newer share; the copy to delete is Home · joined 3 Oct.');
  });

  it('says a leave that went through when the delete after it did not (review I-1)', () => {
    expect(leftNotDeletedLine('Home', 'A purchase is split.', 'left')).toBe('Left the share. Home was not deleted: A purchase is split.');
    expect(leftNotDeletedLine('Home', 'A purchase is split.', 'forgotten')).toBe('The share was forgotten on this phone. Home was not deleted: A purchase is split.');
  });
});

describe('no string the sharing screens show speaks to the reader as "you"', () => {
  it('holds for every string literal in sharing-copy.ts', () => {
    const source = readFileSync(fileURLToPath(new URL('./sharing-copy.ts', import.meta.url)), 'utf8');
    const strings = stringLiterals(source);
    expect(strings.length).toBeGreaterThan(40);
    for (const text of strings) expect(text, text).not.toMatch(/\b(you|your|my)\b/i);
  });
});

describe('the invite text', () => {
  it('names Events for an event and Add workspace for a workspace, by the button’s real name', () => {
    expect(inviteText('event', 'Budi', 'Coast week', 'cicis://join/X', 'AAAA')).toBe(
      'Budi sent an invite to Coast week. Open cicis://join/X — or choose Join with a code on Events in the app and enter AAAA',
    );
    expect(inviteText('workspace', 'Budi', 'Home', 'cicis://join/X', 'AAAA')).toBe(
      'Budi sent an invite to Home. Open cicis://join/X — or choose Add workspace › Join with a code in the app and enter AAAA',
    );
  });
});
