import { afterEach, describe, expect, it, vi } from 'vitest';
import { arriveFrom, flightKeyframes, leaveFrom, MOVE_MS, poseFrom, poseTransform, springAt, springProgress, WALLET_SPRING } from './card-motion';

describe('springAt', () => {
  it('starts from rest and ends on its mark', () => {
    expect(springAt(0)).toBe(0);
    expect(springAt(-1)).toBe(0);
    expect(springAt(MOVE_MS / 1000)).toBeCloseTo(1, 2);
  });

  it('is most of the way there early, as a spring is, rather than halfway at half time', () => {
    expect(springAt(0.25)).toBeGreaterThan(0.9);
  });

  it('settles a hint past its mark — about one per cent, a card’s few pixels — and never bounces back below it by as much', () => {
    const samples = Array.from({ length: 600 }, (_, ms) => springAt(ms / 1000));
    const peak = Math.max(...samples);
    expect(peak).toBeGreaterThan(1.005);
    expect(peak).toBeLessThan(1.02);
    const afterPeak = samples.slice(samples.indexOf(peak));
    expect(Math.min(...afterPeak)).toBeGreaterThan(0.995);
  });

  it('never overshoots when critically damped', () => {
    const samples = Array.from({ length: 1000 }, (_, ms) => springAt(ms / 1000, { response: WALLET_SPRING.response, damping: 1 }));
    expect(Math.max(...samples)).toBeLessThanOrEqual(1);
  });
});

describe('springProgress', () => {
  it('samples the spring at even steps, from 0 to exactly 1', () => {
    const progress = springProgress(560, 28);
    expect(progress).toHaveLength(29);
    expect(progress[0]).toBe(0);
    expect(progress.at(-1)).toBe(1);
    expect(progress[14]).toBeCloseTo(springAt(0.28), 10);
  });
});

describe('flightKeyframes', () => {
  it('carries a card from one pose to the other, every keyframe the same transform shape', () => {
    const frames = flightKeyframes({ x: 0, y: 300, scale: 0.5 }, { x: 0, y: 0, scale: 1 }, [0, 0.5, 1]);
    expect(frames.map((frame) => frame.offset)).toEqual([0, 0.5, 1]);
    expect(frames.map((frame) => frame.transform)).toEqual(['translate(0px, 300px) scale(0.5)', 'translate(0px, 150px) scale(0.75)', 'translate(0px, 0px) scale(1)']);
    expect(frames.every((frame) => frame.opacity === undefined)).toBe(true);
  });

  it('holds an opacity through the flight when asked, for a card that rests out of sight', () => {
    expect(flightKeyframes({ x: 0, y: 0, scale: 1 }, { x: 0, y: 10, scale: 1 }, [0, 1], 1).map((frame) => frame.opacity)).toEqual([1, 1]);
  });
});

describe('poseFrom', () => {
  it('is the shift and scale that put a card back where it was, measured from its own corner', () => {
    // Raised to the top at full width, from a grid cell half as wide further down and to the right.
    expect(poseFrom({ left: 201, top: 500, width: 179 }, { left: 16, top: 68 }, { x: 0, y: 0, scale: 1 }, 358)).toEqual({ x: 185, y: 432, scale: 0.5 });
  });

  it('reads past the resting pose of a card in the pile', () => {
    const rest = { x: 7.16, y: 0, scale: 0.96 };
    const pose = poseFrom({ left: 16, top: 286, width: 358 }, { left: 16 + 7.16, top: 852 }, rest, 358);
    expect(pose).toEqual({ x: 0, y: -566, scale: 1 });
  });
});

describe('poseTransform', () => {
  it('is no transform at all for a card at rest, and a shift then a scale otherwise', () => {
    expect(poseTransform({ x: 0, y: 0, scale: 1 })).toBe('none');
    expect(poseTransform({ x: 7.123, y: 0, scale: 0.96 })).toBe('translate(7.12px, 0px) scale(0.96)');
  });
});

describe('the hand-off between layouts', () => {
  afterEach(() => vi.useRealTimers());

  it('gives the arriving layout where the card left from, once', () => {
    leaveFrom('bca', { left: 10, top: 20, width: 170, height: 107 });
    expect(arriveFrom(['bca', 'ovo'])).toEqual({ key: 'bca', rect: { left: 10, top: 20, width: 170, height: 107 } });
    expect(arriveFrom(['bca'])).toBeNull();
  });

  it('keeps nothing for a card the arriving layout does not hold', () => {
    leaveFrom('bca', { left: 0, top: 0, width: 1, height: 1 });
    expect(arriveFrom(['ovo'])).toBeNull();
    expect(arriveFrom()).toBeNull();
  });

  it('forgets a hand-off nobody took in time', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    leaveFrom('bca', { left: 0, top: 0, width: 1, height: 1 });
    vi.advanceTimersByTime(700);
    expect(arriveFrom()).toBeNull();
  });
});
