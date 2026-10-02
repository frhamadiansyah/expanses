import { describe, expect, it } from 'vitest';
import { CAPTURE_GUIDES, isShortcutLink, SCREEN_SCANNER_SHORTCUT_URL } from './guides';

describe('the capture setup guides', () => {
  it('covers the three ways in, each with steps to follow', () => {
    expect(CAPTURE_GUIDES.map((guide) => guide.key)).toEqual(['notifications', 'screen-scanner', 'receipt']);
    for (const guide of CAPTURE_GUIDES) {
      expect(guide.title).not.toBe('');
      expect(guide.blurb).not.toBe('');
      expect(guide.steps.length).toBeGreaterThan(0);
      for (const step of guide.steps) expect(step.trim()).not.toBe('');
    }
  });

  it('names no bank, wallet or merchant — the country-neutral rule reaches the copy too', () => {
    const copy = CAPTURE_GUIDES.flatMap((guide) => [guide.title, guide.blurb, guide.note ?? '', ...guide.steps]).join(' ');
    const named = ['BCA', 'BNI', 'BRI', 'Mandiri', 'CIMB', 'Permata', 'GoPay', 'OVO', 'DANA', 'ShopeePay', 'Jenius'];
    for (const name of named) {
      expect(copy).not.toMatch(new RegExp(`\\b${name}\\b`, 'i'));
    }
  });

  it('opens only an iCloud shared shortcut from the Add button', () => {
    expect(isShortcutLink('https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef')).toBe(true);
    expect(isShortcutLink('https://www.icloud.com/shortcuts/0123456789abcdef')).toBe(false);
    expect(isShortcutLink('http://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef')).toBe(false);
    expect(isShortcutLink('https://example.com/shortcuts/0123456789abcdef0123456789abcdef')).toBe(false);
    if (SCREEN_SCANNER_SHORTCUT_URL !== null) expect(isShortcutLink(SCREEN_SCANNER_SHORTCUT_URL)).toBe(true);
  });
});
