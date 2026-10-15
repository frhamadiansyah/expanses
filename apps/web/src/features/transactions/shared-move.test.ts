import { describe, expect, it } from 'vitest';
import { keptText, moveHint } from './shared-move';

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
