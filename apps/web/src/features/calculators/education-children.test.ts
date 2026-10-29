import { describe, expect, it } from 'vitest';
import { childLabel, educationGoalName } from './education-children';

describe('a child on the Education fund page', () => {
  it('is called by its name, or by its place while unnamed', () => {
    expect(childLabel(' Nadia ', 0)).toBe('Nadia');
    expect(childLabel('', 1)).toBe('Child 2');
  });
  it('is saved as a goal named for it', () => {
    expect(educationGoalName('Nadia')).toBe('Education fund · Nadia');
    expect(educationGoalName('  ')).toBe('Education fund');
  });
});
