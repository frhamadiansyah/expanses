import { describe, expect, it } from 'vitest';
import { ROW_PAD_X, rowHeight } from './metrics';
import { planFormRow, planSwitchRow } from './form-row';

describe('planFormRow', () => {
  it('shows a chosen picker value in the tint, with the chevron that says it reopens', () => {
    expect(planFormRow('picker', 'Groceries')).toEqual({ text: 'Groceries', tone: 'ink-2', chevron: true, placeholder: false });
  });

  it('shows an unanswered picker as a grey prompt, still pointing at what it opens', () => {
    expect(planFormRow('picker', null, 'Choose a category')).toEqual({
      text: 'Choose a category',
      tone: 'ink-3',
      chevron: true,
      placeholder: true,
    });
  });

  it('treats an empty string as unanswered, not as an answer of nothing', () => {
    expect(planFormRow('picker', '', 'Choose a category').placeholder).toBe(true);
  });

  it('gives a typed field no chevron, because nothing opens — the caret is already there', () => {
    expect(planFormRow('typed', 'Superindo Bintaro')).toEqual({
      text: 'Superindo Bintaro',
      tone: 'ink',
      chevron: false,
      placeholder: false,
    });
  });

  it('draws a shown-not-asked value in the quieter ink and never points at anything', () => {
    expect(planFormRow('static', 'Rumah tangga')).toEqual({ text: 'Rumah tangga', tone: 'ink-2', chevron: false, placeholder: false });
  });

  it('withholds the chevron from an empty typed field, which has nowhere to go either', () => {
    expect(planFormRow('typed', null, 'Optional').chevron).toBe(false);
  });
});

describe('planSwitchRow', () => {
  it('is the same line every other form row is, at the same height and the same inset', () => {
    const plan = planSwitchRow({ checked: true });
    expect(plan.minHeight).toBe(rowHeight(false));
    expect(plan.separatorInset).toBe(ROW_PAD_X);
  });

  it('says which way the answer is set, so a row can announce it rather than only draw it', () => {
    expect(planSwitchRow({ checked: true }).state).toBe('on');
    expect(planSwitchRow({ checked: false }).state).toBe('off');
  });

  it('quietens the label only when the answer cannot be changed', () => {
    expect(planSwitchRow({ checked: false }).labelTone).toBe('ink');
    expect(planSwitchRow({ checked: false, disabled: true }).labelTone).toBe('ink-3');
  });

  it('draws no hint paragraph when there is no hint', () => {
    expect(planSwitchRow({ checked: false }).hint).toBe(false);
    expect(planSwitchRow({ checked: false, hint: true }).hint).toBe(true);
  });
});
