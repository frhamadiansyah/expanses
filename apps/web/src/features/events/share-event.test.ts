import type { CreatedInvite, MoveRefusal } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { freshShare, runShare } from './share-event';

const invite = { code: 'x' } as unknown as CreatedInvite;
const steps = (log: string[], over: Partial<Parameters<typeof runShare>[1]> = {}) => ({
  share: async () => (log.push('share'), 'b1'),
  convert: async (): Promise<MoveRefusal[]> => (log.push('convert'), []),
  invite: async () => (log.push('invite'), invite),
  ...over,
});

describe('sharing an existing event (§6)', () => {
  it('shares and moves once, however many times it is tapped while running', async () => {
    const log: string[] = [];
    const progress = freshShare();
    const first = runShare(progress, steps(log));
    const second = runShare(progress, steps(log));
    expect(await second).toBeNull();
    expect((await first)?.invite).toBe(invite);
    expect(log).toEqual(['share', 'convert', 'invite']);
  });

  it('after a failed move, retries the move but never makes a second shared event', async () => {
    const log: string[] = [];
    const progress = freshShare();
    await expect(runShare(progress, steps(log, { convert: async () => { throw new Error('No TRY rate for today yet'); } }))).rejects.toThrow('rate');
    await runShare(progress, steps(log));
    expect(log.filter((l) => l === 'share')).toHaveLength(1);
    expect(log.filter((l) => l === 'convert')).toHaveLength(1);
  });

  it('does not move twice once it has moved', async () => {
    const log: string[] = [];
    const progress = freshShare();
    await runShare(progress, steps(log, { invite: async () => { throw new Error('offline'); } })).catch(() => undefined);
    await runShare(progress, steps(log));
    expect(log.filter((l) => l === 'convert')).toHaveLength(1);
  });
});
