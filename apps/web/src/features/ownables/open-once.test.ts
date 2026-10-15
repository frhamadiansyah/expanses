import { describe, expect, it } from 'vitest';
import { openOnce } from './open-once';

describe('openOnce', () => {
  it('opens the account, then does what follows on it', async () => {
    const done: string[] = [];
    const memory = { id: null as string | null };

    const id = await openOnce(memory, async () => 'wallet-1', async (opened) => void done.push(opened));

    expect(id).toBe('wallet-1');
    expect(done).toEqual(['wallet-1']);
  });

  it('never opens a second account when what follows failed and Save is pressed again: only what follows is tried again', async () => {
    let opened = 0;
    let tries = 0;
    const memory = { id: null as string | null };
    const open = async () => `wallet-${++opened}`;
    const after = async () => {
      tries += 1;
      if (tries === 1) throw new Error('The digits could not be saved');
    };

    await expect(openOnce(memory, open, after)).rejects.toThrow('The digits could not be saved');
    const id = await openOnce(memory, open, after);

    expect(opened).toBe(1);
    expect(tries).toBe(2);
    expect(id).toBe('wallet-1');
  });
});
