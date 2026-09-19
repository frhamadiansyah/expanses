import { describe, expect, it } from 'vitest';
import { afterUpdate } from './after-update';

describe('afterUpdate', () => {
  it('says nothing on an ordinary open', () => {
    expect(afterUpdate({ applied: [], from: 47, blocked: null })).toBe(null);
    expect(afterUpdate(undefined)).toBe(null);
  });

  it('says nothing on the first run on a device', () => {
    // Every migration ran, but there was no data here to update: nobody needs reassuring about that.
    expect(afterUpdate({ applied: [1, 2, 3], from: 0, blocked: null })).toBe(null);
  });

  it('offers a backup after a real update, naming the version reached', () => {
    const note = afterUpdate({ applied: [46, 47], from: 45, blocked: null });
    expect(note).toMatchObject({ kind: 'updated', version: 47 });
    expect(note?.headline).toBe('Your data was updated to version 47');
  });

  it('says an update was undone, and outranks whatever else the open applied', () => {
    const note = afterUpdate({ applied: [46], from: 45, blocked: 48 });
    expect(note).toMatchObject({ kind: 'undone', version: 48 });
    expect(note?.body).toContain('exactly as it was');
    expect(note?.body).toContain('Nothing was lost');
  });
});
