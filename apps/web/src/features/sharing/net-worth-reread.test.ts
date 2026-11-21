import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { rereadNetWorth } from './net-worth-queries';

describe('a sync run heard by every net worth hook on a screen', () => {
  it('reads net worth again once, not once a listener', async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    for (let listener = 0; listener < 6; listener++) rereadNetWorth(client);
    expect(invalidate).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(invalidate.mock.calls).toEqual([[{ queryKey: ['net-worth'] }]]);
    // The next run is heard again.
    rereadNetWorth(client);
    await Promise.resolve();
    expect(invalidate).toHaveBeenCalledTimes(2);
  });
});
