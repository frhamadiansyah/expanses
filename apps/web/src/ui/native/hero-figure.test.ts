import { describe, expect, it } from 'vitest';
import { FIGURE_WIDTH, figureSize, heroFigure, progressFraction, progressPercent, progressTone } from './hero-figure';
import { textWidth } from './metrics';

describe('figureSize', () => {
  it('draws a figure that fits the column at the kit 40', () => {
    expect(figureSize('Rp 45.000')).toBe(40);
    expect(figureSize('Rp 4.250.000')).toBe(40);
  });

  it('steps a long figure down, rather than letting it run off the screen', () => {
    // A Jakarta house and a mortgage: twelve digits at 40 px is wider than a phone's panel, and the page went with it.
    expect(figureSize('Rp 171.274.729')).toBe(34);
    expect(figureSize('Rp 1.023.015.200')).toBe(30);
  });

  it('never picks a size that does not fit, for as long as the floor can hold it', () => {
    for (const minor of [45_000, 4_250_000, 171_274_729, 1_023_015_200, 12_345_678_901]) {
      const { text } = heroFigure(minor, 'IDR');
      expect(textWidth(text, figureSize(text)), text).toBeLessThanOrEqual(FIGURE_WIDTH);
    }
  });

  it('stops at the floor rather than shrinking money into a caption', () => {
    expect(figureSize('Rp 12.345.678.901.234.567')).toBe(26);
  });
});

describe('heroFigure', () => {
  it('draws a purchase in alarm, formatted with no decimals for IDR', () => {
    expect(heroFigure(899_000, 'IDR', 'out')).toEqual({ text: 'Rp 899.000', tone: 'alarm' });
  });

  it('draws money arriving in the tint', () => {
    expect(heroFigure(18_500_000, 'IDR', 'in')).toEqual({ text: 'Rp 18.500.000', tone: 'tint' });
  });

  it('alarms a net worth that has gone below zero, and leaves a positive one alone', () => {
    expect(heroFigure(-4_250_000, 'IDR').tone).toBe('alarm');
    expect(heroFigure(1_284_300_000, 'IDR').tone).toBe('ink');
  });
});

describe('progressFraction', () => {
  it('is the ratio of the two figures', () => {
    expect(progressFraction(7_000_000, 14_000_000)).toBe(0.5);
  });

  it('fills to the end and stops, rather than running off the track', () => {
    expect(progressFraction(21_000_000, 14_000_000)).toBe(1);
  });

  it('is empty against nothing budgeted, rather than dividing by zero', () => {
    expect(progressFraction(12_400_000, 0)).toBe(0);
    expect(Number.isFinite(progressFraction(12_400_000, 0))).toBe(true);
  });

  it('is empty when nothing has been spent, including when the figure is below zero', () => {
    expect(progressFraction(0, 14_000_000)).toBe(0);
    expect(progressFraction(-500_000, 14_000_000)).toBe(0);
  });
});

describe('progressPercent', () => {
  it('rounds the ratio to a whole percent for the label and for aria-valuenow', () => {
    expect(progressPercent(12_400_000, 14_000_000)).toBe(89);
    // A first Rp 1.000 against a Rp 100.000.000 goal is 0 %, not a bar that pretends to have started.
    expect(progressPercent(1_000, 100_000_000)).toBe(0);
  });
});

describe('progressTone', () => {
  it('stays in the tint while there is room left', () => {
    expect(progressTone(12_400_000, 14_000_000)).toBe('tint');
    expect(progressTone(14_000_000, 14_000_000)).toBe('tint');
  });

  it('turns to alarm the moment the target is passed, so a full bar still says which kind of full', () => {
    expect(progressTone(14_000_001, 14_000_000)).toBe('alarm');
  });

  it('is quiet when there is no target to be over', () => {
    expect(progressTone(12_400_000, 0)).toBe('ink-3');
  });
});
