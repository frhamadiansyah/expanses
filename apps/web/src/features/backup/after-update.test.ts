import { beforeEach, describe, expect, it } from 'vitest';
import { afterUpdate, bannerStandsDown } from './after-update';
import { dismissUpdateCard, resetUpdateCardDismissal, subscribeToUpdateCard, updateCardDismissed } from './reminder-state';

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

  it('never claims an update was undone when the data is already past it', () => {
    /*
     * A block outlives the open that wrote it. A rollback that could not put the bytes back, or a backup
     * restored over the top, leaves a device whose file is above the blocked version — where "your update
     * was undone" would be a permanent, untrue sentence about data that is perfectly fine.
     */
    expect(afterUpdate({ applied: [], from: 48, blocked: 47 })).toBe(null);
    expect(afterUpdate({ applied: [], from: 47, blocked: 47 })).toBe(null);
    expect(afterUpdate({ applied: [], from: 46, blocked: 47 })).toMatchObject({ kind: 'undone' });
  });

  it('claims no knowledge of which check or which step was at fault', () => {
    const note = afterUpdate({ applied: [], from: 46, blocked: 47 });
    // The run's first version is what gets blocked after a failed check, which is not the culprit — so
    // nothing here may name one, or name the check that spoke.
    expect(note?.body).not.toMatch(/did not add up|check/i);
  });
});

describe('bannerStandsDown', () => {
  const note = afterUpdate({ applied: [46, 47], from: 45, blocked: null });

  it('stands down only while the card is really on screen', () => {
    expect(bannerStandsDown(note, false)).toBe(true);
    // Dismissed without exporting: the 7/14/30-day ladder must come straight back, not wait for a reload.
    expect(bannerStandsDown(note, true)).toBe(false);
    expect(bannerStandsDown(null, false)).toBe(false);
  });
});

describe('the card dismissal both of them read', () => {
  beforeEach(() => resetUpdateCardDismissal());

  it('tells everyone watching, once', () => {
    let told = 0;
    const stop = subscribeToUpdateCard(() => {
      told += 1;
    });
    expect(updateCardDismissed()).toBe(false);
    dismissUpdateCard();
    expect(updateCardDismissed()).toBe(true);
    dismissUpdateCard();
    expect(told).toBe(1);
    stop();
    resetUpdateCardDismissal();
    dismissUpdateCard();
    expect(told).toBe(1);
  });
});
