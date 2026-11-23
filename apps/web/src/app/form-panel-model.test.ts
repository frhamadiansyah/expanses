import { describe, expect, it } from 'vitest';
import { isPanelForm, panelBase } from './form-panel-model';

describe('panelBase', () => {
  it('names the page each form belongs to', () => {
    expect(panelBase('/transactions/new')).toBe('/transactions');
    expect(panelBase('/transactions/t1/edit')).toBe('/transactions');
    expect(panelBase('/cards/new')).toBe('/wallet');
    expect(panelBase('/accounts/new')).toBe('/wallet');
    expect(panelBase('/accounts/a1/move')).toBe('/accounts/a1');
    expect(panelBase('/events/e1/plan/new')).toBe('/events/e1');
    expect(panelBase('/events/e1/shared-plan/i1/edit')).toBe('/events/e1');
    expect(panelBase('/events/e1/plan/link/t9')).toBe('/events/e1');
    expect(panelBase('/net-worth/lend-borrow/new-payable')).toBe('/net-worth/lend-borrow');
    expect(panelBase('/debts/new')).toBe('/net-worth/plan');
    expect(panelBase('/goals/g1/edit/')).toBe('/goals');
  });
  it('leaves every page that is not a form alone', () => {
    for (const path of ['/transactions', '/wallet', '/cards/c1', '/cards/points', '/accounts/a1', '/goals/g1', '/budget', '/net-worth/assets', '/transactions/receipt-split', '/net-worth/plan/pay-first', '/events/e1/plan']) {
      expect(isPanelForm(path)).toBe(false);
    }
  });
});
