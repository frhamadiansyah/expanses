import { describe, expect, it } from 'vitest';
import { KEEP_OWN_PROBLEM, type ProblemInput, syncProblemsOf, syncRowValue } from './sync-problems';

const quiet: ProblemInput = {
  bookName: 'Family',
  lost: false,
  failedLine: null,
  heldText: null,
  placeable: false,
  holders: [],
  forgettable: false,
  forgetLine: null,
  silenceText: null,
  outdated: [],
};

describe('the Sync row and its To fix list (redesign A1)', () => {
  it('nothing wrong: no problem, and the row says Up to date (or what it is doing)', () => {
    expect(syncProblemsOf(quiet)).toEqual([]);
    expect(syncRowValue({ running: false, waiting: 0 })).toBe('Up to date');
    expect(syncRowValue({ running: true, waiting: 3 })).toBe('Syncing…');
    expect(syncRowValue({ running: false, waiting: 2 })).toBe('2 waiting to send');
  });

  it('every warning the Share page showed becomes one problem, each with where it is fixed', () => {
    const problems = syncProblemsOf({
      ...quiet,
      lost: true,
      failedLine: 'Last sync failed: no internet',
      heldText: '3 rows wait for a workspace',
      placeable: true,
      holders: [{ bookId: 'b-old', label: 'Family (old copy)' }],
      forgettable: true,
      forgetLine: 'Kept here as it was',
      silenceText: 'Nothing from Andi for 3 days',
      outdated: [{ name: 'Andi', version: '0.5.1' }],
    });
    expect(problems.map((problem) => [problem.key, problem.fix?.kind ?? null])).toEqual([
      ['lost', 'discard'],
      ['failed', 'sync'],
      ['held', 'place'],
      ['holder:b-old', 'holder'],
      ['silence', null],
      ['outdated:Andi', null],
      ['forget', 'forget'],
    ]);
    expect(problems.find((problem) => problem.key === 'outdated:Andi')!.title).toBe('Andi’s phone is on 0.5.1');
    expect(problems.find((problem) => problem.key === 'forget')!.title).toBe(KEEP_OWN_PROBLEM);
  });

  it('net worth asked of this phone, and a review left to answer, are listed with where each is answered (review round 1)', () => {
    const problems = syncProblemsOf({ ...quiet, netWorthAsked: 'Rina set up household net worth: one tax ID.', reviewDue: true });
    expect(problems.map((problem) => [problem.key, problem.fix?.kind])).toEqual([
      ['nw-asked', 'tax'],
      ['nw-review', 'review'],
    ]);
  });

  it('rows still held by a copy that exists cannot be placed yet: listed, no fix', () => {
    expect(syncProblemsOf({ ...quiet, heldText: '3 rows are in Family (old copy)' })[0]).toMatchObject({ key: 'held', fix: null });
  });

  it('never says you or your', () => {
    const all = syncProblemsOf({ ...quiet, lost: true, failedLine: 'x', heldText: 'x', placeable: true, holders: [{ bookId: 'b', label: 'Home' }], forgettable: true, outdated: [{ name: 'Andi', version: null }] });
    for (const problem of all) expect(`${problem.title} ${problem.subtitle ?? ''}`).not.toMatch(/\byou(r)?\b/i);
  });
});
