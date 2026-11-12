import { describe, expect, it } from 'vitest';
import { RING_LABELS, RING_OPTIONS, ringRowFooter, ringSheetFooter, ringVar, takenLabel } from './rings';

describe('ring copy (owner rings, 12 Nov)', () => {
  it('names every colour of the palette, in its order', () => {
    expect(RING_OPTIONS.map((colour) => RING_LABELS[colour])).toEqual(['Blue', 'Purple', 'Teal', 'Indigo', 'Orange', 'Brown', 'Magenta']);
    expect(ringVar('teal')).toBe('var(--owner-teal)');
  });

  it('says what the ring is for, and whose colours are taken, in the words of the mockup', () => {
    expect(ringRowFooter('Rina')).toBe('The ring round each of Rina’s accounts on Net worth, Assets and Liabilities, the same on every phone in the household.');
    expect(takenLabel('Andi')).toBe('Andi’s');
    expect(ringSheetFooter(['Andi'])).toBe('Andi’s colour is taken, so two people never share one.');
    expect(ringSheetFooter(['Andi', 'Budi'])).toBe('Andi’s and Budi’s colours are taken, so two people never share one.');
    expect(ringSheetFooter([])).toBeNull();
  });

  it('never speaks to the reader as “you”', () => {
    const lines = [ringRowFooter('Rina'), ringSheetFooter(['Andi']), ringSheetFooter(['Andi', 'Budi', 'Sari'])].join(' ');
    expect(lines).not.toMatch(/\byou(r|rs)?\b/i);
  });
});
