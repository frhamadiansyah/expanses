import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/pwa', () => ({ isNative: () => false }));

import { joinCodeOf, listenForJoinLinks } from './deep-link';

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
