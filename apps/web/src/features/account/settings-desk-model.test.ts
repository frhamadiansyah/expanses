import { describe, expect, it } from 'vitest';
import { matchSections, readSection, SETTINGS_SECTIONS, settingsBack, settingsSearch, shownSection, writeSection } from './settings-desk-model';

const store = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
};

describe('the sections (Mac Settings A)', () => {
  it('reads Workspaces & sharing, Devices & sync, Backup, Defaults, Categories, Activity, then Capture (iPhone) and About', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.name)).toEqual(['Workspaces & sharing', 'Devices & sync', 'Backup', 'Defaults', 'Categories', 'Activity', 'Capture', 'About']);
  });

  it('repeats none of the sidebar’s places', () => {
    const words = SETTINGS_SECTIONS.flatMap((section) => [section.name, ...section.rows]);
    for (const place of ['Budget', 'Recurring', 'Bills', 'Events', 'Goals', 'Debt-free plan', 'Review', 'Calculators', 'Tax report', 'Import']) expect(words).not.toContain(place);
  });
});

describe('which section is shown', () => {
  const all = SETTINGS_SECTIONS.map((section) => section.key).filter((key) => key !== 'capture');

  it('is the one the address names first, then the one last chosen, then the first', () => {
    expect(shownSection('backup', 'activity', all)).toBe('backup');
    expect(shownSection(undefined, 'activity', all)).toBe('activity');
    expect(shownSection(undefined, null, all)).toBe('workspaces');
  });

  it('never one the device does not draw', () => {
    expect(shownSection('capture', null, all)).toBe('workspaces');
    expect(shownSection(undefined, 'capture', all)).toBe('workspaces');
  });

  it('reads ?section= only when it names a section', () => {
    expect(settingsSearch({ section: 'backup' })).toEqual({ section: 'backup' });
    expect(settingsSearch({ section: 'nonsense' })).toEqual({});
    expect(settingsSearch({})).toEqual({});
  });

  it('remembers the choice on the device, and forgets nothing it cannot read', () => {
    const storage = store();
    expect(readSection(storage)).toBeNull();
    writeSection('defaults', storage);
    expect(readSection(storage)).toBe('defaults');
    storage.setItem('cicis.settings.section', 'gone');
    expect(readSection(storage)).toBeNull();
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(readSection(broken)).toBeNull();
    expect(() => writeSection('backup', broken)).not.toThrow();
  });
});

describe('Search', () => {
  it('is every section with nothing typed', () => {
    expect(matchSections(' ', SETTINGS_SECTIONS)).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it('finds a section by its name, with no rows under it', () => {
    expect(matchSections('BACK', SETTINGS_SECTIONS)).toEqual([{ key: 'backup', hits: [] }]);
  });

  it('finds a section by a row, and says which', () => {
    expect(matchSections('link', SETTINGS_SECTIONS)).toEqual([{ key: 'devices', hits: ['Link a device'] }]);
    expect(matchSections('restore', SETTINGS_SECTIONS)).toEqual([{ key: 'backup', hits: ['Restore from iCloud', 'Restore from a file'] }]);
  });

  it('needs every word, in any order', () => {
    expect(matchSections('device link', SETTINGS_SECTIONS)).toEqual([{ key: 'devices', hits: ['Link a device'] }]);
    expect(matchSections('zebra', SETTINGS_SECTIONS)).toEqual([]);
  });

  it('finds the device’s own rows too: a workspace by its name', () => {
    expect(matchSections('rumah', SETTINGS_SECTIONS, { workspaces: ['Personal', 'Rumah Tangga'] })).toEqual([{ key: 'workspaces', hits: ['Rumah Tangga'] }]);
  });
});

describe('the way back from a page Settings opens', () => {
  it('is the Account page on a phone, as it was', () => {
    expect(settingsBack(false, 'workspaces')).toEqual({ back: 'Account', backTo: '/account' });
  });

  it('is Settings at the page’s own section on a wide screen', () => {
    expect(settingsBack(true, 'workspaces')).toEqual({ back: 'Settings', backTo: '/account', backSearch: { section: 'workspaces' } });
    expect(settingsBack(true, 'activity')).toEqual({ back: 'Settings', backTo: '/account', backSearch: { section: 'activity' } });
  });
});
