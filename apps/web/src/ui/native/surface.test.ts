import { describe, expect, it } from 'vitest';
import { GROUP_GAP, GROUP_RADIUS, ROW_PAD_X } from './metrics';
import { planPanel } from './surface';

describe('planPanel', () => {
  it('is a group’s own surface: the group’s radius and the group’s gap, never numbers of its own', () => {
    const plan = planPanel();
    expect(plan.radius).toBe(GROUP_RADIUS);
    expect(plan.gap).toBe(GROUP_GAP);
  });

  it('starts its text on the same line a row’s text starts on', () => {
    expect(planPanel().padding).toBe(ROW_PAD_X);
  });

  it('asks for no padding when what is inside draws its own rows', () => {
    expect(planPanel({ pad: false }).padding).toBe(0);
  });

  it('stops at the reading column by default, and takes the full width only when told', () => {
    expect(planPanel().column).toBe(true);
    expect(planPanel({ wide: true }).column).toBe(false);
  });
});
