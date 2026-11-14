import { describe, expect, it } from 'vitest';
import { finishRow, shareFooter } from './event-settings';

describe('finishRow', () => {
  const today = '2026-12-10';

  it('offers Mark as done on an open event, and says where it goes', () => {
    expect(finishRow({ name: 'Osaka', endsOn: '2026-12-14', finishedAt: null }, today)).toEqual({
      label: 'Mark as done',
      footer: 'Moves Osaka to Past. It can be reopened.',
    });
  });

  it('offers Reopen on a done event, with the day it was done', () => {
    expect(finishRow({ name: 'Osaka', endsOn: '2026-12-14', finishedAt: '2026-12-09T12:00:00.000Z' }, today)).toEqual({
      label: 'Reopen',
      footer: 'Done on 9 Dec. Reopening moves it back to Now and next.',
    });
  });

  it('promises no move for an event whose last day has gone by: it is in Past either way', () => {
    expect(finishRow({ name: 'Osaka', endsOn: '2026-12-02', finishedAt: null }, today).footer).toBe('Osaka has ended and is already in Past.');
    expect(finishRow({ name: 'Osaka', endsOn: '2026-12-02', finishedAt: '2026-12-03T12:00:00.000Z' }, today).footer).toBe('Done on 3 Dec. It has ended, so it stays in Past.');
  });
});

describe('shareFooter', () => {
  it('names the household, one or several', () => {
    expect(shareFooter(['Rani'])).toBe('On: Rani sees the event and adds to it.');
    expect(shareFooter(['Rani', 'Bayu'])).toBe('On: Rani and Bayu see the event and add to it.');
  });
});
