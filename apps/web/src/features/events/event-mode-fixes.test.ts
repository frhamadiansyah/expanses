import { describe, expect, it, vi } from 'vitest';
import { reviewSearch } from '../../app/from-search';
import { recordsOnForm } from '../review/draft-form';
import { saveListOnce } from '../transactions/paste-review';
import { postTag, recordedIntoText } from '../transactions/shared-move';
import { eventForMode } from '../transactions/tx-form';
import { addInCurrency, draftShowsEvent, eventModeApplies, formEvent, takesEventMode } from './event-mode';

/* Event mode fix round 1: one test per finding. Names and figures are invented. */

describe('H1: a pasted list is saved once', () => {
  it('a move that throws after the post still counts the list as saved, posted once, and says why', async () => {
    const post = vi.fn(async () => ['t1', 't2']);
    const finish = vi.fn(async () => undefined);
    const outcome = await saveListOnce({ post, move: async () => Promise.reject(new Error('offline')), saidSaved: '2 added', finish });
    expect(post).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ saved: true, note: '2 added. Not moved into the event: offline' });
    expect(finish).toHaveBeenCalledWith('2 added. Not moved into the event: offline');
  });

  it('a refused move is said; a way out that fails still leaves it saved', async () => {
    const outcome = await saveListOnce({
      post: async () => ['t1'],
      move: async () => 'Saved in Personal. Not moved into Lake trip: No rate yet',
      saidSaved: '1 added',
      finish: async () => Promise.reject(new Error('navigation')),
    });
    expect(outcome).toEqual({ saved: true, note: '1 added. Saved in Personal. Not moved into Lake trip: No rate yet' });
  });

  it('only a failed post leaves the list to try again', async () => {
    const move = vi.fn(async () => null);
    const outcome = await saveListOnce({ post: async () => Promise.reject(new Error('disk')), move, saidSaved: '1 added', finish: async () => undefined });
    expect(outcome.saved).toBe(false);
    expect(move).not.toHaveBeenCalled();
  });
});

describe('H2: into a shared event, posted with no tag and then moved', () => {
  it('a shared event is applied by the move, a private one by the posting', () => {
    expect(postTag('e-shared', true)).toEqual({ eventId: null, moveInto: 'e-shared' });
    expect(postTag('e-private', false)).toEqual({ eventId: 'e-private', moveInto: null });
    expect(postTag('', true)).toEqual({ eventId: null, moveInto: null });
    expect(postTag(null, false)).toEqual({ eventId: null, moveInto: null });
  });
});

describe('M1: a moved purchase is said with no Undo', () => {
  it('names where it went', () => {
    expect(recordedIntoText('Corner market', 'Lake trip')).toBe('Recorded Corner market · moved into Lake trip');
  });
});

describe('M3: a shared event that takes nothing new takes no event mode', () => {
  it('Done, left or no longer shared ends it; an active one and a private one keep it', () => {
    expect(takesEventMode({ state: 'active', finishedAt: null })).toBe(true);
    expect(takesEventMode({ state: 'active', finishedAt: '2026-11-15T10:00:00Z' })).toBe(false);
    expect(takesEventMode({ state: 'left', finishedAt: null })).toBe(false);
    expect(takesEventMode(null)).toBe(true);
  });
});

describe('M4: the currency is pinned only when it says something', () => {
  const trip = (currency: string, own: string | null) => ({ mode: { currency }, event: { currency: own } });
  it('Add in in the base currency, for an event with none of its own, pins nothing', () => {
    expect(addInCurrency(trip('IDR', null), 'IDR')).toBeNull();
    expect(addInCurrency(trip('TRY', null), 'IDR')).toBe('TRY');
    expect(addInCurrency(trip('IDR', 'IDR'), 'IDR')).toBe('IDR');
    // ✕ on One line's chip: no line event, no currency.
    expect(addInCurrency(null, 'IDR')).toBeNull();
  });

  it('a private event never fills in a shared workspace’s spending; a shared one does', () => {
    expect(eventModeApplies({ shared: undefined }, false)).toBe(true);
    expect(eventModeApplies({ shared: undefined }, true)).toBe(false);
    expect(eventModeApplies({ shared: { sharedWith: 1 } }, true)).toBe(true);
    expect(eventModeApplies(null, false)).toBe(false);
  });
});

describe('the event on another tab (rounds 1 and 2)', () => {
  it('Transfer and Trade always drop it', () => {
    expect(eventForMode('e1', 'expense', true)).toBe('e1');
    expect(eventForMode('e1', 'transfer')).toBe('');
    expect(eventForMode('e1', 'trade')).toBe('');
  });

  it('Income drops only the event event mode filled in; one from Add spending, a hand pick or an edit stays', () => {
    expect(eventForMode('e1', 'income', true)).toBe('');
    expect(eventForMode('e1', 'income', false)).toBe('e1');
  });
});

describe('round 2: One line and Paste a list wait for the mode to be read', () => {
  const trip = { shared: undefined, name: 'Lake trip' };
  it('nothing is tagged, and nothing saved, while it is read', () => {
    expect(formEvent({ ready: false, active: null }, false, false)).toEqual({ waiting: true, active: null });
    expect(formEvent({ ready: false, active: trip }, false, false)).toEqual({ waiting: true, active: null });
  });

  it('read: the event, unless ✕ left it out or it does not apply here', () => {
    expect(formEvent({ ready: true, active: trip }, false, false)).toEqual({ waiting: false, active: trip });
    expect(formEvent({ ready: true, active: trip }, true, false)).toEqual({ waiting: false, active: null });
    expect(formEvent({ ready: true, active: trip }, false, true)).toEqual({ waiting: false, active: null });
    expect(formEvent({ ready: true, active: null }, false, false)).toEqual({ waiting: false, active: null });
  });
});

describe('round 2: a private event is not claimed in a shared workspace', () => {
  it('a To review row names a private event only outside a shared workspace, and a shared event anywhere', () => {
    expect(draftShowsEvent('e-private', {}, false)).toBe(true);
    expect(draftShowsEvent('e-private', {}, true)).toBe(false);
    expect(draftShowsEvent('e-shared', { 'e-shared': {} }, true)).toBe(true);
    expect(draftShowsEvent(null, {}, false)).toBe(false);
  });
});

describe('low: a draft for a shared event is recorded on its form', () => {
  it('the table and a swipe send it to the form; any other is recorded as it stands', () => {
    expect(recordsOnForm({ eventId: 'e-shared' }, { 'e-shared': {} })).toBe(true);
    expect(recordsOnForm({ eventId: 'e-private' }, { 'e-shared': {} })).toBe(false);
    expect(recordsOnForm({ eventId: null }, { 'e-shared': {} })).toBe(false);
  });

  it('Review opens the draft it is sent', () => {
    expect(reviewSearch({ draft: 'd1', from: 'cashflow' })).toEqual({ from: 'cashflow', draft: 'd1' });
    expect(reviewSearch({ draft: '' })).toEqual({});
  });
});
