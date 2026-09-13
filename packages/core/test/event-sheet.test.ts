import { describe, expect, it } from 'vitest';
import { type EventSheetInput, eventSheet } from '../src/index';

const NAMES = { food: 'Food & Drink', gifts: 'Gifts', clothes: 'Clothing', transport: 'Transport' };

const input = (partial: Partial<EventSheetInput> = {}): EventSheetInput => ({
  planned: [
    { categoryId: 'food', plannedMinor: 5_000_000 },
    { categoryId: 'gifts', plannedMinor: 3_000_000 },
  ],
  actuals: [
    { categoryId: 'food', amountBaseMinor: 6_200_000 },
    { categoryId: 'gifts', amountBaseMinor: 2_400_000 },
  ],
  categoryNames: NAMES,
  totalPlannedMinor: null,
  ...partial,
});

describe('eventSheet', () => {
  it('puts what was planned beside what it came to, category by category', () => {
    const sheet = eventSheet(input());

    expect(sheet.lines.map((line) => [line.name, line.plannedMinor, line.actualMinor])).toEqual([
      ['Food & Drink', 5_000_000, 6_200_000],
      ['Gifts', 3_000_000, 2_400_000],
    ]);
  });

  it('adds the plans up when no figure was set for the whole occasion', () => {
    expect(eventSheet(input()).plannedMinor).toBe(8_000_000);
  });

  it('lets one figure for the whole occasion stand instead of the sum', () => {
    expect(eventSheet(input({ totalPlannedMinor: 10_000_000 })).plannedMinor).toBe(10_000_000);
  });

  it('says how far past its plan a category went', () => {
    const sheet = eventSheet(input());

    expect(sheet.lines.find((line) => line.categoryId === 'food')!.overMinor).toBe(1_200_000);
    expect(sheet.lines.find((line) => line.categoryId === 'gifts')!.overMinor).toBe(0);
  });

  it('says how far past the plan the whole occasion went', () => {
    // Rp 8.600.000 spent against Rp 8.000.000 planned.
    expect(eventSheet(input()).overMinor).toBe(600_000);
  });

  it('is not over when it came in under', () => {
    expect(eventSheet(input({ totalPlannedMinor: 20_000_000 })).overMinor).toBe(0);
  });

  it('keeps a planned category that was never spent on', () => {
    const sheet = eventSheet(input({ actuals: [{ categoryId: 'food', amountBaseMinor: 1_000_000 }] }));

    expect(sheet.lines.find((line) => line.categoryId === 'gifts')).toMatchObject({ plannedMinor: 3_000_000, actualMinor: 0 });
  });

  it('flags spending in a category the plan never mentioned', () => {
    const sheet = eventSheet(
      input({ actuals: [...input().actuals, { categoryId: 'transport', amountBaseMinor: 900_000 }] }),
    );
    const transport = sheet.lines.find((line) => line.categoryId === 'transport')!;

    expect(transport.unplanned).toBe(true);
    expect(transport.overMinor).toBeNull();
    expect(sheet.unplannedMinor).toBe(900_000);
  });

  it('treats a category carried with no figure as planned for, but not as a number', () => {
    const sheet = eventSheet(
      input({ planned: [{ categoryId: 'clothes', plannedMinor: null }], actuals: [{ categoryId: 'clothes', amountBaseMinor: 400_000 }] }),
    );

    expect(sheet.lines[0]).toMatchObject({ unplanned: false, plannedMinor: null, overMinor: null });
    expect(sheet.plannedMinor).toBeNull();
    expect(sheet.unplannedMinor).toBe(0);
  });

  it('knows of no overspend while nothing was planned', () => {
    const sheet = eventSheet(input({ planned: [], totalPlannedMinor: null }));

    expect(sheet.plannedMinor).toBeNull();
    expect(sheet.overMinor).toBeNull();
  });

  it('adds up several payments in one category', () => {
    const sheet = eventSheet(
      input({ actuals: [{ categoryId: 'food', amountBaseMinor: 1_000_000 }, { categoryId: 'food', amountBaseMinor: 2_500_000 }] }),
    );

    expect(sheet.lines.find((line) => line.categoryId === 'food')!.actualMinor).toBe(3_500_000);
  });

  it('leads with what cost the most, which is what you look for first', () => {
    const sheet = eventSheet(
      input({
        planned: [{ categoryId: 'food', plannedMinor: 1_000 }, { categoryId: 'gifts', plannedMinor: 1_000 }],
        actuals: [{ categoryId: 'food', amountBaseMinor: 100 }, { categoryId: 'gifts', amountBaseMinor: 900 }],
      }),
    );

    expect(sheet.lines.map((line) => line.categoryId)).toEqual(['gifts', 'food']);
  });

  it('falls back to the id when a category has no name to show', () => {
    expect(eventSheet(input({ categoryNames: {} })).lines[0]!.name).toBe('food');
  });
});
