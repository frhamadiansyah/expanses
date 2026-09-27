import { describe, expect, it } from 'vitest';
import { currencyRefusal, deviceName, ownerName, payerLine, preparing, sharedWith, sinceWhen, statusLine, syncedAgo } from './sharing-copy';

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

describe('the status line (§11)', () => {
  const base = { state: 'active' as const, members: [fandri, dewi], me: 'd', waiting: 0, lastSyncedAt: NOW - 1000, failing: false, now: NOW };

  it('says each of the five things §11 lists', () => {
    expect(statusLine(base)).toBe('Up to date');
    expect(statusLine({ ...base, waiting: 3 })).toBe('3 changes waiting');
    expect(statusLine({ ...base, waiting: 1 })).toBe('1 change waiting');
    const tuesday = new Date(2026, 8, 29, 9, 30).getTime();
    expect(statusLine({ ...base, failing: true, lastSyncedAt: tuesday })).toBe('Not synced since Tue');
    expect(statusLine({ ...base, state: 'needs_invite' })).toBe('Ask Fandri for a new invite to keep sharing');
    expect(statusLine({ ...base, state: 'unshared' })).toBe('No longer shared by Fandri');
  });

  it('never says Up to date before a sync has happened', () => {
    expect(statusLine({ ...base, lastSyncedAt: null })).toBe('Not synced yet');
    expect(statusLine({ ...base, lastSyncedAt: null, failing: true })).toBe('Not synced yet');
  });

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
