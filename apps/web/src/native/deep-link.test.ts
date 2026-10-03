import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));

import { isReviewLink, joinCodeOf, listenForJoinLinks, listenForReviewLinks } from './deep-link';

describe('a join link (spec §8.1, §11)', () => {
  const code = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789-ABCD-EFGH-JKMN-PQRS-TVWX';

  it('gives its code, however the system hands it over', () => {
    expect(joinCodeOf(`cicis://join/${code}`)).toBe(code);
    expect(joinCodeOf(`CICIS://join/${code}/`)).toBe(code);
    expect(joinCodeOf(`cicis://join//${encodeURIComponent(code)}`)).toBe(code);
  });

  it('is nothing for any other address', () => {
    expect(joinCodeOf('cicis://join/')).toBeNull();
    expect(joinCodeOf('https://example.com/join/abc')).toBeNull();
    expect(joinCodeOf('cicis://settings')).toBeNull();
    // A broken escape in the link is no code at all, never a thrown error inside the URL handler.
    expect(joinCodeOf('cicis://join/%E0%A4%A')).toBeNull();
  });

  it('is not listened for outside the shell', () => {
    const open = vi.fn();
    listenForJoinLinks(open)();
    expect(open).not.toHaveBeenCalled();
  });
});

describe('the link the share sheet opens the app with', () => {
  it('is cicis://review, however iOS hands it over', () => {
    expect(isReviewLink('cicis://review')).toBe(true);
    expect(isReviewLink('CICIS://review/')).toBe(true);
    expect(isReviewLink(' cicis://review ')).toBe(true);
  });

  it('is nothing else', () => {
    expect(isReviewLink('cicis://join/abc')).toBe(false);
    expect(isReviewLink('cicis://reviews')).toBe(false);
    expect(isReviewLink('https://example.com/review')).toBe(false);
  });

  it('is not listened for outside the shell', () => {
    const open = vi.fn();
    listenForReviewLinks(open)();
    expect(open).not.toHaveBeenCalled();
  });
});
