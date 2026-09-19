import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenStage } from '../../db/open';
import { openingCopy, PACE_MS, paceStages } from './opening-copy';

describe('openingCopy', () => {
  it('names the stage in the voice the rest of the app uses', () => {
    expect(openingCopy({ stage: 'opening' })).toEqual({
      title: 'Opening your data…',
      body: 'Starting the database on this device. Nothing leaves it.',
      percent: null,
    });
    expect(openingCopy({ stage: 'snapshotting' })).toMatchObject({ title: 'Taking a copy first…' });
    expect(openingCopy({ stage: 'checking' })).toMatchObject({ title: 'Checking your data…' });
  });

  it('counts the step being worked on, not the one before it', () => {
    // `migrate` reports two finished, and is about to start the third of seven.
    expect(openingCopy({ stage: 'migrating', done: 2, total: 7, name: 'book_indexes', copied: true })).toEqual({
      title: 'Updating your data…',
      body: 'Step 3 of 7 · book_indexes · Do not close the app. Your data was copied before we started.',
      percent: 29,
    });
    // The closing call: everything is finished, so the count is already the total and must not run past it.
    const last = openingCopy({ stage: 'migrating', done: 7, total: 7, name: 'book_indexes', copied: true });
    expect(last.percent).toBe(100);
    expect(last.body).toContain('Step 7 of 7');
  });

  it('never promises a safety copy that was not taken', () => {
    const body = openingCopy({ stage: 'migrating', done: 0, total: 2, name: 'ledger', copied: false }).body;
    expect(body).toBe('Step 1 of 2 · ledger · Do not close the app.');
    expect(body).not.toContain('copied');
  });

  it('shows no fraction where there is no honest one', () => {
    for (const stage of [{ stage: 'opening' }, { stage: 'snapshotting' }, { stage: 'checking' }] as const) {
      expect(openingCopy(stage).percent).toBe(null);
    }
    // A run of no steps cannot be a fraction of itself; the words still say what is happening.
    expect(openingCopy({ stage: 'migrating', done: 0, total: 0, name: 'ledger', copied: false }).percent).toBe(null);
  });
});

describe('paceStages', () => {
  let painted: OpenStage[];
  beforeEach(() => {
    vi.useFakeTimers();
    painted = [];
  });
  afterEach(() => vi.useRealTimers());

  it('never repaints for an open that is over in a blink', () => {
    const paced = paceStages((stage) => painted.push(stage));
    paced.onStage({ stage: 'opening' });
    paced.onStage({ stage: 'checking' });
    // The app itself is on screen well inside the delay: nothing the open passed through is ever painted.
    paced.stop();
    vi.advanceTimersByTime(PACE_MS * 10);
    expect(painted).toEqual([]);
  });

  it('never repaints the screen that is already on display', () => {
    // main.tsx paints "Opening your data…" before the engine is asked for anything, and the opener then
    // reports that very stage as its first. The identical screen must not be scheduled a second time.
    const paced = paceStages((stage) => painted.push(stage), { showing: { stage: 'opening' } });
    paced.onStage({ stage: 'opening' });
    vi.advanceTimersByTime(PACE_MS * 10);
    expect(painted).toEqual([]);
    // Anything that would say something new still gets its turn.
    paced.onStage({ stage: 'snapshotting' });
    vi.advanceTimersByTime(PACE_MS);
    expect(painted).toEqual([{ stage: 'snapshotting' }]);
    // And a stage repeated after a real paint is dropped in just the same way.
    paced.onStage({ stage: 'snapshotting' });
    vi.advanceTimersByTime(PACE_MS * 10);
    expect(painted).toHaveLength(1);
  });

  it('paints a stage that really is taking a while', () => {
    const paced = paceStages((stage) => painted.push(stage));
    paced.onStage({ stage: 'snapshotting' });
    vi.advanceTimersByTime(PACE_MS - 1);
    expect(painted).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(painted).toEqual([{ stage: 'snapshotting' }]);
  });

  it('paints an update at once, and every step of it', () => {
    const paced = paceStages((stage) => painted.push(stage));
    paced.onStage({ stage: 'snapshotting' });
    paced.onStage({ stage: 'migrating', done: 0, total: 2, name: 'account_types', copied: true });
    paced.onStage({ stage: 'migrating', done: 1, total: 2, name: 'book_indexes', copied: true });
    // Both steps are on screen with no timer run at all; the snapshot they overtook never painted.
    expect(painted.map((s) => (s.stage === 'migrating' ? s.done : s.stage))).toEqual([0, 1]);
    vi.advanceTimersByTime(PACE_MS * 10);
    expect(painted).toHaveLength(2);
  });

  it('drops a stage that was still waiting when the app appeared', () => {
    const paced = paceStages((stage) => painted.push(stage));
    paced.onStage({ stage: 'checking' });
    paced.stop();
    vi.advanceTimersByTime(PACE_MS * 10);
    // A timer that fired over the top of the app would replace it with a screen saying "Checking your data…".
    expect(painted).toEqual([]);
    paced.onStage({ stage: 'migrating', done: 0, total: 1, name: 'ledger', copied: true });
    expect(painted).toEqual([]);
  });
});
