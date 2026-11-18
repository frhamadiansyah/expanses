import { describe, expect, it } from 'vitest';
import {
  CHART_PAGE_KEY,
  finishOn,
  fitLine,
  fitText,
  readChartPage,
  savingBar,
  savingRows,
  stepPage,
  swipeStep,
  timelineAxis,
  timelineLanes,
  writeChartPage,
} from './goals-desk-model';

/** Invented goals: what each needs a month in rupiah minor units (IDR has no decimals), and the fit `fitByRank` gave. */
const goals = [
  { goalId: 'ef', name: 'Emergency fund', kind: 'emergency' as const, neededBaseMinor: 3_600_000, done: false },
  { goalId: 'ret', name: 'Retirement', kind: 'retirement' as const, neededBaseMinor: 2_150_000, done: false },
  { goalId: 'trip', name: 'Japan in spring', kind: 'holiday' as const, neededBaseMinor: 2_720_000, done: false },
  { goalId: 'car', name: 'Car down payment', kind: 'vehicle' as const, neededBaseMinor: 2_400_000, done: false },
  { goalId: 'paid', name: 'Wedding', kind: 'wedding' as const, neededBaseMinor: 0, done: true },
  { goalId: 'funded', name: 'Umrah', kind: 'umrah' as const, neededBaseMinor: 0, done: false },
];
const fits = [
  { goalId: 'ef', fundedMonthlyMinor: 3_600_000, fits: 'full' as const },
  { goalId: 'funded', fundedMonthlyMinor: 0, fits: 'full' as const },
  { goalId: 'ret', fundedMonthlyMinor: 2_150_000, fits: 'full' as const },
  { goalId: 'trip', fundedMonthlyMinor: 650_000, fits: 'partial' as const },
  { goalId: 'car', fundedMonthlyMinor: 0, fits: 'none' as const },
  { goalId: 'paid', fundedMonthlyMinor: 0, fits: 'full' as const },
];

describe('where saving goes: the rows read summary.fits, in its order', () => {
  it('fits in full, gets part, waits — each goal still running that needs something a month', () => {
    const rows = savingRows(fits, goals);
    expect(rows.map((row) => [row.goalId, row.fits])).toEqual([
      ['ef', 'full'],
      ['ret', 'full'],
      ['trip', 'partial'],
      ['car', 'none'],
    ]);
    // A done goal and one that needs nothing more take no part of the month's saving, so no row.
    expect(rows.find((row) => row.goalId === 'paid' || row.goalId === 'funded')).toBeUndefined();
    expect(rows.map((row) => fitText(row, 'IDR'))).toEqual(['fits in full', 'fits in full', 'gets Rp 650.000 of 2.720.000', 'waits']);
  });

  it('the figures are the fit’s own: what each gets is fundedMonthlyMinor, what it needs the base need it was given', () => {
    const rows = savingRows(fits, goals);
    expect(rows.reduce((sum, row) => sum + row.fundedMinor, 0)).toBe(3_600_000 + 2_150_000 + 650_000);
    expect(rows.find((row) => row.goalId === 'trip')).toMatchObject({ neededMinor: 2_720_000, fundedMinor: 650_000 });
  });

  it('a goal with no rate to the base needs nothing the chart can draw', () => {
    expect(savingRows([{ goalId: 'x', fundedMonthlyMinor: 0, fits: 'full' }], [{ goalId: 'x', name: 'Abroad', kind: 'education', neededBaseMinor: null, done: false }])).toEqual([]);
  });

  it('the grey line says the rows in goal order', () => {
    expect(fitLine(savingRows(fits, goals))).toBe('In goal order, 2 fit in full, Japan in spring in part, Car down payment waits.');
    expect(fitLine([{ name: 'A', fits: 'full' }, { name: 'B', fits: 'none' }, { name: 'C', fits: 'none' }])).toBe('In goal order, 1 fits in full, 2 wait.');
    expect(fitLine([{ name: 'A', fits: 'none' }])).toBe('In goal order, A waits.');
    expect(fitLine([{ name: 'A', fits: 'full' }, { name: 'B', fits: 'full' }])).toBe('In goal order, all 2 fit in full.');
    expect(fitLine([{ name: 'A', fits: 'full' }])).toBe('The one goal fits in full.');
    expect(fitLine([])).toBeNull();
  });

  it('the bar lays the needs end to end, the line where Saved a month reaches, the rest hatched', () => {
    const rows = savingRows(fits, goals);
    const total = 3_600_000 + 2_150_000 + 2_720_000 + 2_400_000;
    const bar = savingBar(rows, 6_400_000);
    expect(bar.pieces.map((piece) => piece.goalId)).toEqual(['ef', 'ret', 'trip', 'car']);
    expect(bar.pieces[0]).toMatchObject({ from: 0, width: 3_600_000 / total });
    expect(bar.pieces[1]!.from).toBeCloseTo(3_600_000 / total);
    const last = bar.pieces.at(-1)!;
    expect(last.from + last.width).toBeCloseTo(1);
    expect(bar.line).toBeCloseTo(6_400_000 / total);
    expect(bar.short).toEqual({ from: bar.line, width: 1 - bar.line });
  });

  it('saving more than is needed: the line is the bar’s end and nothing is hatched', () => {
    const bar = savingBar([{ goalId: 'a', kind: 'holiday', neededMinor: 1_000_000 }], 4_000_000);
    expect(bar.line).toBe(1);
    expect(bar.pieces[0]!.width).toBe(0.25);
    expect(bar.short).toBeNull();
    expect(savingBar([], 0)).toEqual({ pieces: [], line: 0, short: null });
  });
});

describe('when each goal is due: the timeline lanes', () => {
  const today = '2026-11-18';

  it('runs to the year after the latest date within ten years, a tick every two years over six', () => {
    const axis = timelineAxis(['2028-06-30', '2051-01-31', '2031-10-31', '2027-04-30'], today);
    expect(axis.end).toBe('2032-01-01');
    expect(axis.ticks.map((tick) => tick.label)).toEqual(['2028', '2030', '2032']);
    expect(axis.ticks.at(-1)!.at).toBe(1);
    expect(axis.ticks[0]!.at).toBeGreaterThan(0);
  });

  it('two years at least, a tick a year when the span is short', () => {
    const axis = timelineAxis(['2027-03-31'], today);
    expect(axis.end).toBe('2028-01-01');
    expect(axis.ticks.map((tick) => tick.label)).toEqual(['2027', '2028']);
    expect(timelineAxis([], today).end).toBe('2028-01-01');
  });

  it('a lane’s ring sits at its date; one past the edge has none and is filled on the same scale', () => {
    const axis = timelineAxis(['2031-12-31', '2051-01-31'], today);
    const [near, far] = timelineLanes(
      [
        { goalId: 'h', name: 'Hajj', kind: 'hajj', dueOn: '2029-05-18', progress: 0.5, behind: false },
        { goalId: 'r', name: 'Retirement', kind: 'retirement', dueOn: '2051-01-31', progress: 0.04, behind: true },
      ],
      axis,
      today,
    );
    const total = (Date.parse('2032-01-01') - Date.parse(today)) / 86_400_000;
    const due = (Date.parse('2029-05-18') - Date.parse(today)) / 86_400_000 / total;
    expect(near!.at).toBeCloseTo(due);
    // Half saved: filled half way along its own track, today to its date.
    expect(near!.fill).toBeCloseTo(due / 2);
    expect(near!.dueLabel).toBe('May 2029');
    expect(far!.at).toBeNull();
    expect(far!.dueLabel).toBe('Jan 2051');
    expect(far!.behind).toBe(true);
    const farDue = (Date.parse('2051-01-31') - Date.parse(today)) / 86_400_000 / total;
    expect(far!.fill).toBeCloseTo(Math.min(1, farDue * 0.04));
  });

  it('a date already passed sits at today, and progress is held between nought and whole', () => {
    const axis = timelineAxis([], today);
    const [late, over] = timelineLanes(
      [
        { goalId: 'a', name: 'A', kind: 'other', dueOn: '2026-01-31', progress: 0.3, behind: true },
        { goalId: 'b', name: 'B', kind: 'other', dueOn: '2027-11-18', progress: 1.4, behind: false },
      ],
      axis,
      today,
    );
    expect(late!.at).toBe(0);
    expect(late!.fill).toBe(0);
    expect(over!.fill).toBeCloseTo(over!.at!);
  });

  it('a goal finishes on its last stage still to pay, else its last stage', () => {
    expect(finishOn([{ dueOn: '2027-01-31', state: 'saving' }, { dueOn: '2028-01-31', state: 'later' }])).toBe('2028-01-31');
    expect(finishOn([{ dueOn: '2027-01-31', state: 'paid' }, { dueOn: '2028-01-31', state: 'paid' }])).toBe('2028-01-31');
    expect(finishOn([{ dueOn: '2027-01-31', state: 'saving' }, { dueOn: '2028-01-31', state: 'paid' }])).toBe('2027-01-31');
    expect(finishOn([])).toBeNull();
  });
});

describe('the chart box’s two pages', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key), kept };
  };

  it('remembers the page shown last on this device, the first page when none was kept', () => {
    const storage = memory();
    expect(readChartPage(storage)).toBe('saving');
    writeChartPage('due', storage);
    expect(storage.kept.get(CHART_PAGE_KEY)).toBe('due');
    expect(readChartPage(storage)).toBe('due');
    writeChartPage('saving', storage);
    expect(storage.kept.has(CHART_PAGE_KEY)).toBe(false);
    expect(readChartPage(storage)).toBe('saving');
  });

  it('storage that refuses is the first page, and a write that throws is let go', () => {
    const refusing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readChartPage(refusing)).toBe('saving');
    expect(() => writeChartPage('due', refusing)).not.toThrow();
    expect(readChartPage(undefined)).toBe('saving');
  });

  it('steps one page along, never past either end', () => {
    expect(stepPage('saving', 1)).toBe('due');
    expect(stepPage('due', 1)).toBe('due');
    expect(stepPage('due', -1)).toBe('saving');
    expect(stepPage('saving', -1)).toBe('saving');
  });

  it('a two-finger swipe turns the page once it has travelled far enough sideways', () => {
    expect(swipeStep(12)).toBe(0);
    expect(swipeStep(-39)).toBe(0);
    expect(swipeStep(40)).toBe(1);
    expect(swipeStep(-55)).toBe(-1);
  });
});
