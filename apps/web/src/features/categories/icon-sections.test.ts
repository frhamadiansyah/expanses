import { describe, expect, it } from 'vitest';
import { ICONS } from './CategoryIcon';
import { ICON_SECTIONS, ICON_WORDS, iconMatches, searchIcons } from './icon-sections';

describe('icon sections', () => {
  it('shelves every icon the app draws exactly once, and nothing it cannot draw', () => {
    const shelved = ICON_SECTIONS.flatMap((section) => section.keys);
    expect([...shelved].sort()).toEqual(Object.keys(ICONS).sort());
    expect(new Set(shelved).size).toBe(shelved.length);
  });

  it('keeps the approved order of shelves', () => {
    expect(ICON_SECTIONS.map((s) => s.title)).toEqual([
      'Food & drink', 'Transport', 'Home & bills', 'Health & care', 'Shopping', 'Money', 'Fun & travel', 'Family & pets', 'Work & learning', 'Other',
    ]);
  });

  it('gives words only to icons that exist', () => {
    expect(Object.keys(ICON_WORDS).filter((key) => !ICONS[key])).toEqual([]);
  });
});

describe('icon search', () => {
  const keys = (query: string) => searchIcons(query).flatMap((s) => s.keys);

  it('finds an icon by its own name, ignoring case, hyphens and number suffixes', () => {
    expect(keys('Coffee')).toContain('coffee');
    expect(keys('shopping bag')).toContain('shopping-bag');
    expect(keys('gamepad')).toContain('gamepad-2');
  });

  it('finds icons by English and Indonesian words', () => {
    expect(keys('kopi')).toEqual(['coffee']);
    expect(keys('bensin')).toContain('fuel');
    expect(keys('mobil')).toContain('car');
    expect(keys('rumah')).toContain('house');
    expect(keys('listrik')).toContain('zap');
    expect(keys('pdam')).toContain('droplets');
    expect(keys('internet')).toContain('wifi');
    expect(keys('pulsa')).toContain('smartphone');
    expect(keys('belanja')).toContain('shopping-bag');
    expect(keys('hewan')).toEqual(expect.arrayContaining(['paw-print', 'dog', 'cat']));
    expect(keys('bayi')).toContain('baby');
    expect(keys('sehat')).toContain('heart-pulse');
    expect(keys('sekolah')).toContain('graduation-cap');
    expect(keys('hadiah')).toContain('gift');
    expect(keys('liburan')).toContain('plane');
    expect(keys('makan')).toContain('utensils');
  });

  it('keeps the shelves, drops the empty ones, and answers nothing for nonsense', () => {
    expect(searchIcons('kopi').map((s) => s.title)).toEqual(['Food & drink']);
    expect(searchIcons('').length).toBe(ICON_SECTIONS.length);
    expect(searchIcons('zzqx')).toEqual([]);
    expect(iconMatches('coffee', '   ')).toBe(true);
  });
});
