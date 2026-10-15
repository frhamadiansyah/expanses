import type { CreatedInvite, MoveRefusal } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { type ConversionSteps, finishConversion, freshShare, needsFinishing, runShare } from './share-event';

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

describe('finishing a share cut short (I9)', () => {
  const left = { remaining: 0, localItems: 0, sharedItems: 0, setWithoutCategories: false };
  const conversion = (log: string[], over: Partial<ConversionSteps> = {}): ConversionSteps => ({
    sharedItemCount: async () => 0,
    derivedIds: async () => new Set(['t-moved']),
    tagged: async () => ['t-moved', 't-left', 't-transfer'],
    convert: async () => (log.push('convert'), [{ transactionId: 't-moved', why: 'Already in a shared event' }]),
    move: async (ids) => (log.push(`move ${ids.join(',')}`), [{ transactionId: 't-transfer', why: 'Only a purchase from one account under one category moves into a shared event' }]),
    ...over,
  });

  it('runs the whole conversion while the shared plan is empty, leaving out what had already moved', async () => {
    const log: string[] = [];
    expect(await finishConversion(conversion(log))).toEqual([]);
    expect(log).toEqual(['convert']);
  });

  it('never copies the plan again once an item is on it: only what is still in a workspace moves', async () => {
    const log: string[] = [];
    const kept = await finishConversion(conversion(log, { sharedItemCount: async () => 2 }));
    expect(log).toEqual(['move t-left,t-transfer']);
    expect(kept.map((k) => k.transactionId)).toEqual(['t-transfer']);
  });

  it('is offered while something was left behind, and not once marked done', () => {
    expect(needsFinishing(left, false)).toBe(false);
    expect(needsFinishing({ ...left, remaining: 1 }, false)).toBe(true);
    expect(needsFinishing({ ...left, localItems: 3 }, false)).toBe(true);
    expect(needsFinishing({ ...left, localItems: 3, sharedItems: 3 }, false)).toBe(false);
    expect(needsFinishing({ ...left, setWithoutCategories: true }, false)).toBe(true);
    expect(needsFinishing({ ...left, remaining: 1 }, true)).toBe(false);
  });
});
