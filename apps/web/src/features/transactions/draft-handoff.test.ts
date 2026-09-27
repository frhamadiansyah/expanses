import { describe, expect, it } from 'vitest';
import { clearStashedDraft, hasStashedDraft, noteAddedAccount, readStashedDraft, stashDraft } from './draft-handoff';
import { emptyForm } from './tx-form';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

describe('a new transaction set aside while an account is added', () => {
  it('comes back once, as typed, with the account just made', () => {
    const storage = memory();
    const draft = { ...emptyForm('book', '2026-09-27'), description: 'Coffee', amount: '45.000' };
    stashDraft(draft, 1_000, storage);
    expect(hasStashedDraft(2_000, storage)).toBe(true);
    noteAddedAccount('jago', storage);

    const back = readStashedDraft(2_000, storage);
    expect(back?.draft).toMatchObject({ description: 'Coffee', amount: '45.000' });
    expect(back?.addedAccountId).toBe('jago');
    // Read twice (a render run twice) it is still there; cleared once opened, the next New transaction starts empty.
    expect(readStashedDraft(2_000, storage)).not.toBeNull();
    clearStashedDraft(storage);
    expect(readStashedDraft(2_000, storage)).toBeNull();
  });

  it('comes back without an account when none was made, and not at all once it is stale', () => {
    const storage = memory();
    stashDraft(emptyForm('book', '2026-09-27'), 0, storage);
    expect(readStashedDraft(60_000, storage)?.addedAccountId).toBeUndefined();

    stashDraft(emptyForm('book', '2026-09-27'), 0, storage);
    expect(hasStashedDraft(11 * 60_000, storage)).toBe(false);
    expect(readStashedDraft(11 * 60_000, storage)).toBeNull();
  });

  it('marks nothing when no draft is waiting', () => {
    const storage = memory();
    noteAddedAccount('jago', storage);
    expect(readStashedDraft(0, storage)).toBeNull();
  });
});
