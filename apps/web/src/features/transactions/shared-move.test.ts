import { describe, expect, it } from 'vitest';
import { keptText, moveAfterSave, moveHint, stayedBehind } from './shared-move';

describe('tagging into a shared event (§6)', () => {
  it('says the purchase moves, and to whom it is shown', () => {
    expect(moveHint('Coast week', 2)).toBe('Moves to Coast week, shared with 2 people.');
    expect(moveHint('Coast week', 1)).toBe('Moves to Coast week, shared with 1 person.');
  });

  it('says what stayed, and why', () => {
    expect(keptText([{ transactionId: 't', why: 'A refund stays where it is' }])).toBe('1 stayed where it was: A refund stays where it is');
    expect(keptText([{ transactionId: 'a', why: 'x' }, { transactionId: 'b', why: 'y' }])).toBe('2 stayed where they were: x; y');
    expect(keptText([{ transactionId: 'a', why: 'x' }, { transactionId: 'b', why: 'x' }])).toBe('2 stayed where they were: x');
  });
});

describe('what stayed behind a move, never silently (trip exchange fix)', () => {
  it('is what the move kept, with its reasons', () => {
    expect(stayedBehind(['a', 'b'], { moved: [{ transactionId: 'a' }], listed: [], kept: [{ transactionId: 'b', why: 'x' }] })).toEqual([{ transactionId: 'b', why: 'x' }]);
  });

  it('nothing when every chosen row moved or was listed', () => {
    expect(stayedBehind(['a', 'b', 'a'], { moved: [{ transactionId: 'a' }], listed: [{ transactionId: 'b' }], kept: [] })).toEqual([]);
  });

  it('a chosen row the move said nothing about stays, said so, rather than vanishing from the message', () => {
    expect(stayedBehind(['a', 'b'], { moved: [], listed: [{ transactionId: 'a' }], kept: [] })).toEqual([{ transactionId: 'b', why: 'It could not be moved' }]);
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
