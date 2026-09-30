import { describe, expect, it } from 'vitest';
import { landing } from './sheet-detents';

const at = (height: number, velocity = 0) => landing({ height, velocity, medium: 420, large: 760 });

describe('landing', () => {
  it('goes to the nearer detent after a slow drag', () => {
    expect(at(700)).toBe('large');
    expect(at(500)).toBe('medium');
    expect(at(591)).toBe('large');
  });
  it('follows a flick, up to large or down to medium', () => {
    expect(at(450, -0.8)).toBe('large');
    expect(at(740, 0.8)).toBe('medium');
  });
  it('closes when pulled well below medium, slowly or with a flick', () => {
    expect(at(200)).toBe('close');
    expect(at(360, 0.8)).toBe('close');
    expect(at(400)).toBe('medium');
  });
});
