import { onlineManager } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import { createAppQueryClient } from './query-client';

afterEach(() => onlineManager.setOnline(true));

describe('createAppQueryClient (E2E-1)', () => {
  it('re-reads the local database while the phone is offline', async () => {
    onlineManager.setOnline(false);
    const client = createAppQueryClient();
    const read = client.fetchQuery({ queryKey: ['shared-event', 'ws', 'trip'], queryFn: async () => 'Boat · Not sent yet' });
    const paused = new Promise((resolve) => setTimeout(() => resolve('paused'), 200));
    expect(await Promise.race([read, paused])).toBe('Boat · Not sent yet');
  });
});
