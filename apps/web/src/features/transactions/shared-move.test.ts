import { describe, expect, it } from 'vitest';
import { keptText, moveAfterSave, moveHint } from './shared-move';

describe('tagging into a shared event (§6)', () => {
  it('says the purchase moves, and to whom it is shown', () => {
    expect(moveHint('Coast week', 2)).toBe('Moves to Coast week, shared with 2 people.');
    expect(moveHint('Coast week', 1)).toBe('Moves to Coast week, shared with 1 person.');
  });

  it('says what stayed, and why', () => {
    expect(keptText([{ transactionId: 't', why: 'A refund stays where it is' }])).toBe('1 stayed where it was: A refund stays where it is');
    expect(keptText([{ transactionId: 'a', why: 'x' }, { transactionId: 'b', why: 'y' }])).toBe('2 stayed where they were: x');
  });
});

describe('a purchase saved, then moved into a shared event (sync gaps fix round 1, #3)', () => {
  const where = { bookName: 'Family', eventName: 'Coast week' };

  it('says nothing when it moved', async () => {
    expect(await moveAfterSave(async () => ({ kept: [] }), where)).toBeNull();
  });

  it('a refused move is said, never thrown: the purchase is already saved, and a second Save would record it twice', async () => {
    expect(await moveAfterSave(async () => ({ kept: [{ transactionId: 't', why: 'No TRY rate for 2026-10-06 yet' }] }), where)).toBe(
      'Saved in Family. Not moved into Coast week: No TRY rate for 2026-10-06 yet',
    );
    expect(await moveAfterSave(async () => Promise.reject(new Error('Coast week is done. Reopen it to change anything.')), where)).toBe(
      'Saved in Family. Not moved into Coast week: Coast week is done. Reopen it to change anything.',
    );
  });
});
