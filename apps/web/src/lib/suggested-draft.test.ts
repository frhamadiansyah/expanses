import { describe, expect, it } from 'vitest';
import { type DraftAction, type DraftState, draftValue, emptyDraft, suggestedDraftReducer } from './suggested-draft';

interface Payment {
  occurredOn: string;
  moneyId: string;
  principal: string;
  interest: string;
}

const BLANK: Payment = { occurredOn: '2026-09-22', moneyId: '', principal: '', interest: '' };
const SCHEDULED: Partial<Payment> = { occurredOn: '2026-09-22', principal: '2007385', interest: '5250000' };

function run(actions: DraftAction<Payment>[]): Payment {
  const state = actions.reduce<DraftState<Payment>>((was, action) => suggestedDraftReducer(was, action), emptyDraft());
  return draftValue(state, BLANK);
}

/** What a browser does when a key is pressed in a field: the field's value as shown, plus the key. */
function typeInto(field: keyof Payment, text: string, actions: DraftAction<Payment>[]): DraftAction<Payment>[] {
  const out = [...actions];
  for (const key of text) out.push({ type: 'edit', patch: { [field]: run(out)[field] + key } });
  return out;
}

describe('a suggested draft', () => {
  it('shows the suggestion once it arrives, in every field nobody touched', () => {
    expect(run([{ type: 'arrive', suggestion: SCHEDULED }])).toEqual({ ...BLANK, ...SCHEDULED });
  });

  it('keeps what was typed when the suggestion arrives in the middle of the typing', () => {
    // The e2e that failed on a warm server: the field was focused and cleared while still empty (clearing an empty
    // field changes nothing, so React sends no change), the schedule's row landed, and the keys went on after it.
    let actions: DraftAction<Payment>[] = [{ type: 'touch', field: 'principal' }];
    actions = [...actions, { type: 'arrive', suggestion: SCHEDULED }];
    actions = typeInto('principal', '5000000', actions);
    expect(run(actions).principal).toBe('5000000');
  });

  it('keeps a typed figure when the suggestion arrives after it', () => {
    const actions = [...typeInto('principal', '5000000', []), { type: 'arrive', suggestion: SCHEDULED } as const];
    const value = run(actions);
    expect(value.principal).toBe('5000000');
    // The fields nobody touched still take the suggestion.
    expect(value.interest).toBe('5250000');
  });

  it('never refills a field from a later arrival, touched or not', () => {
    const later: Partial<Payment> = { principal: '1', interest: '2' };
    const value = run([{ type: 'arrive', suggestion: SCHEDULED }, { type: 'arrive', suggestion: later }]);
    expect(value.principal).toBe('2007385');
    expect(value.interest).toBe('5250000');
  });

  it('fills a field whose suggestion arrives separately, later', () => {
    const value = run([{ type: 'arrive', suggestion: SCHEDULED }, { type: 'arrive', suggestion: { moneyId: 'bca' } }]);
    expect(value.moneyId).toBe('bca');
  });

  it('keeps a field that was focused and left empty empty', () => {
    const value = run([{ type: 'touch', field: 'interest' }, { type: 'arrive', suggestion: SCHEDULED }]);
    expect(value.interest).toBe('');
    expect(value.principal).toBe('2007385');
  });
});
