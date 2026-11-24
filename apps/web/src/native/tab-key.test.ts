import { describe, expect, it } from 'vitest';
import { isPlainTab, nextTabStop, type TabStop } from './tab-key';

const stops = (...list: [string, number][]): TabStop<string>[] => list.map(([node, tabIndex]) => ({ node, tabIndex }));
const row = stops(['date', 0], ['note', 0], ['category', 0], ['paid', 0], ['amount', 0]);

describe('the next Tab stop, in a browser order', () => {
  it('Tab goes to the next field in page order, ⇧Tab to the one before', () => {
    expect(nextTabStop(row, 'date', false)).toBe('note');
    expect(nextTabStop(row, 'paid', false)).toBe('amount');
    expect(nextTabStop(row, 'note', true)).toBe('date');
    expect(nextTabStop(row, 'amount', true)).toBe('paid');
  });

  it('goes round past either end', () => {
    expect(nextTabStop(row, 'amount', false)).toBe('date');
    expect(nextTabStop(row, 'date', true)).toBe('amount');
  });

  it('with nothing focused, Tab takes the first field and ⇧Tab the last', () => {
    expect(nextTabStop(row, null, false)).toBe('date');
    expect(nextTabStop(row, null, true)).toBe('amount');
  });

  it('skips what cannot take focus now, asking only of the fields on the way', () => {
    const asked: string[] = [];
    const usable = (node: string) => {
      asked.push(node);
      return node !== 'category';
    };
    expect(nextTabStop(row, 'note', false, usable)).toBe('paid');
    expect(asked).toEqual(['category', 'paid']);
  });

  it('leaves out tabindex -1, and counts from a focused -1 element where it sits in the page', () => {
    const list = stops(['a', 0], ['menu', -1], ['b', 0], ['c', 0]);
    expect(nextTabStop(list, 'a', false)).toBe('b');
    expect(nextTabStop(list, 'menu', false)).toBe('b');
    expect(nextTabStop(list, 'menu', true)).toBe('a');
  });

  it('puts a positive tabindex first, ascending, then the 0s in page order', () => {
    const list = stops(['a', 0], ['second', 2], ['b', 0], ['first', 1], ['also-second', 2]);
    expect(nextTabStop(list, null, false)).toBe('first');
    expect(nextTabStop(list, 'first', false)).toBe('second');
    expect(nextTabStop(list, 'second', false)).toBe('also-second');
    expect(nextTabStop(list, 'also-second', false)).toBe('a');
    expect(nextTabStop(list, 'b', false)).toBe('first');
    expect(nextTabStop(list, 'a', true)).toBe('also-second');
  });

  it('has nowhere to go when the focused field is the only one', () => {
    expect(nextTabStop(stops(['only', 0]), 'only', false)).toBeNull();
    expect(nextTabStop(stops(), null, false)).toBeNull();
    expect(nextTabStop(row, 'date', false, () => false)).toBeNull();
  });
});

describe('the key presses the Mac app moves focus for', () => {
  const press = (over: Partial<KeyboardEvent> = {}) => ({ key: 'Tab', altKey: false, ctrlKey: false, metaKey: false, isComposing: false, defaultPrevented: false, ...over });

  it('Tab and ⇧Tab alone, which no handler of the page took', () => {
    expect(isPlainTab(press())).toBe(true);
    expect(isPlainTab(press({ shiftKey: true }))).toBe(true);
  });

  it('not one a cell or a list already handled', () => {
    expect(isPlainTab(press({ defaultPrevented: true }))).toBe(false);
  });

  it('not ⌥Tab (the web view moves focus for it itself), ⌘Tab or ⌃Tab, nor while an input method composes', () => {
    expect(isPlainTab(press({ altKey: true }))).toBe(false);
    expect(isPlainTab(press({ metaKey: true }))).toBe(false);
    expect(isPlainTab(press({ ctrlKey: true }))).toBe(false);
    expect(isPlainTab(press({ isComposing: true }))).toBe(false);
  });

  it('not another key', () => {
    expect(isPlainTab(press({ key: 'Enter' }))).toBe(false);
  });
});
