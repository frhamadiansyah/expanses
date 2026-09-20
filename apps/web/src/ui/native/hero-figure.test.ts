import { describe, expect, it } from 'vitest';
import { heroFigure, progressFraction, progressPercent, progressTone } from './hero-figure';

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
