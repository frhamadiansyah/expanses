/*
 * The Mac's Settings (Mac Settings and Tools, A, 2026-11-18), styled like the Mac's own System Settings: an inner column
 * of sections with a Search field, and the chosen section's rows beside it. The phone keeps its Account page; this is
 * what the same address shows on a wide screen. The places the sidebar already lists (Budget, Bills, Goals, …) are not
 * repeated here, and the tools are on the Tools page.
 */

export type SettingsSection = 'workspaces' | 'devices' | 'backup' | 'defaults' | 'categories' | 'activity' | 'capture' | 'about';

export interface SectionInfo {
  key: SettingsSection;
  name: string;
  /** The square's colour, a Mac system colour. */
  tint: string;
  /** The labels of the rows the section draws, so Search finds a section by what is in it. */
  rows: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SectionInfo[] = [
  {
    key: 'workspaces',
    name: 'Workspaces & sharing',
    tint: '#007aff',
    rows: ['Workspaces', 'Add workspace', 'New workspace', 'Join with a code', 'Archived', 'Shared with', 'Members', 'What is shared', 'Sharing settings', 'Share'],
  },
  { key: 'devices', name: 'Devices & sync', tint: '#34c759', rows: ['Link a device', 'Devices', 'This device', 'Sync', 'Sync details'] },
  {
    key: 'backup',
    name: 'Backup',
    tint: '#5ac8fa',
    rows: ['iCloud', 'Back up to iCloud', 'Back up now', 'Restore from iCloud', 'Backup file', 'Download backup', 'Restore from a file', 'Photos', 'Download photos', 'Restore photos', 'Safety copies'],
  },
  { key: 'defaults', name: 'Defaults', tint: '#ff9500', rows: ['Paid with', 'Default paid with', 'New spending'] },
  { key: 'categories', name: 'Categories', tint: '#af52de', rows: ['Expense categories', 'Income categories', 'Sets'] },
  { key: 'activity', name: 'Activity', tint: '#8e8e93', rows: ['What was changed', 'Undo'] },
  // The iPhone's own (Capture reads its notifications and screenshots; the widget is its home screen's): a wide iPhone
  // app only, never the Mac (`isPhoneApp`).
  { key: 'capture', name: 'Capture', tint: '#ff3b30', rows: ['Capture', 'Widget'] },
  { key: 'about', name: 'About', tint: '#8e8e93', rows: ['Version', 'Build', 'Data version'] },
];

const KEYS = new Set<string>(SETTINGS_SECTIONS.map((section) => section.key));

export const isSection = (value: unknown): value is SettingsSection => typeof value === 'string' && KEYS.has(value);

/** The address's `?section=`: one of the sections, or nothing. */
export function settingsSearch(search: Record<string, unknown>): { section?: SettingsSection } {
  return isSection(search.section) ? { section: search.section } : {};
}

const SECTION_KEY = 'cicis.settings.section';

/** The section last chosen on this device, or null. */
export function readSection(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SettingsSection | null {
  try {
    const stored = storage?.getItem(SECTION_KEY);
    return isSection(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function writeSection(section: SettingsSection, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(SECTION_KEY, section);
  } catch {
    // Without storage the choice lasts until the page reloads.
  }
}

/**
 * The section shown: the one the address names (a deep link, or /backup), else the one last chosen here, else the
 * first. One the device does not draw (Capture off the iPhone) is the first instead.
 */
export function shownSection(asked: SettingsSection | undefined, remembered: SettingsSection | null, available: readonly SettingsSection[]): SettingsSection {
  const first = available[0] ?? 'workspaces';
  if (asked && available.includes(asked)) return asked;
  if (remembered && available.includes(remembered)) return remembered;
  return first;
}

const fold = (text: string) => text.toLocaleLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

export interface SectionMatch {
  key: SettingsSection;
  /** The rows that matched, shown under the section's name; empty when the name itself matched. */
  hits: string[];
}

/**
 * Search, as System Settings does it: the sections whose name or rows hold what was typed (every word, any order),
 * each with the rows that matched. `extra` adds rows the device draws today (its workspaces' names, say).
 */
export function matchSections(query: string, sections: readonly SectionInfo[], extra: Partial<Record<SettingsSection, readonly string[]>> = {}): SectionMatch[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections.map((section) => ({ key: section.key, hits: [] }));
  const fits = (text: string) => words.every((word) => fold(text).includes(word));
  return sections.flatMap((section) => {
    if (fits(section.name)) return [{ key: section.key, hits: [] }];
    const hits = [...section.rows, ...(extra[section.key] ?? [])].filter(fits);
    return hits.length > 0 ? [{ key: section.key, hits: hits.slice(0, 2) }] : [];
  });
}
