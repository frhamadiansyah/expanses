import type { SelfDeviceRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import * as copy from './devices-copy';

const NOW = Date.parse('2026-11-21T09:00:00Z');
const row = (over: Partial<SelfDeviceRow>): SelfDeviceRow => ({
  deviceId: 'd', name: 'iPhone', kind: 'phone', appVersion: '0.5.7', addedAt: '2026-11-19T01:00:00Z', lastSyncedAt: null, removedAt: null, thisDevice: false, ...over,
});

describe('the Devices screens’ words', () => {
  it('say where each device stands, this one first, unlinked ones left out of the list', () => {
    const list = copy.linkedDevices([
      row({ deviceId: 'mac', name: 'Mac', addedAt: '2026-11-20T00:00:00Z', lastSyncedAt: '2026-11-21T08:58:00Z' }),
      row({ deviceId: 'phone', thisDevice: true, lastSyncedAt: '2026-11-21T08:59:30Z' }),
      row({ deviceId: 'old', removedAt: '2026-11-20T00:00:00Z' }),
    ]);
    expect(list.map((d) => [d.deviceId, copy.deviceLine(d, NOW)])).toEqual([
      ['phone', 'this device · synced just now'],
      ['mac', 'synced 2 min ago'],
    ]);
  });

  it('offer linking again once unlinked; a device in a group only links others', () => {
    expect(copy.devicesActions({ unlinked: true, others: 2 })).toEqual({ linkAnother: false, linkToAnother: true });
    expect(copy.devicesActions({ unlinked: false, others: 1 })).toEqual({ linkAnother: true, linkToAnother: false });
    expect(copy.devicesActions({ unlinked: false, others: 0 })).toEqual({ linkAnother: true, linkToAnother: true });
  });

  it('count devices and name who a workspace is shared with', () => {
    expect(copy.workspaceLine(2, [])).toBe('on 2 devices');
    expect(copy.workspaceLine(1, [])).toBe('on this device');
    expect(copy.workspaceLine(3, ['Sari'])).toBe('on 3 devices · shared with Sari');
    expect(copy.namesOf(['Sari', 'Budi', 'Ani'])).toBe('Sari, Budi and Ani');
  });

  it('ask and warn without "you", in the mockups’ words', () => {
    const lines = [
      copy.allowTitle('Mac'),
      copy.allowBody('Mac', 'iPhone'),
      copy.replaceWarning({ deviceName: 'Mac', workspaces: 2, transactions: 40, sourceHint: 'other device' }),
      copy.sharesHere('Mac', ['Rumah']),
      copy.seatTitle('iPhone'),
      copy.seatBody('Rumah', ['Sari'], 'iPhone'),
      copy.UNLINKED_BODY,
      copy.JOIN_FAILED_BODY,
      copy.LINK_ANOTHER_FOOTER,
      copy.UNLINK_FOOTER,
    ];
    for (const line of lines) expect(line).not.toMatch(/\byou(r|rs)?\b/i);
    expect(copy.allowTitle('Mac')).toBe('Link Mac?');
    expect(copy.seatBody('Rumah', ['Sari'], 'iPhone')).toBe('Rumah is shared with Sari from the iPhone. Changes made here reach them once the iPhone has synced.');
    expect(copy.replaceWarning({ deviceName: 'Mac', workspaces: 2, transactions: 40, sourceHint: 'other device' })).toBe(
      "This Mac already holds data (2 workspaces, 40 transactions). Linking replaces it with the other device's. A backup file of this Mac is saved first.",
    );
  });
});
