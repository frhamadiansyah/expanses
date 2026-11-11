import { describe, expect, it, vi } from 'vitest';
import { lineState, openCashflowLine, registerLineOpener, setLineState, subscribeLine } from './cashflow-line-store';

describe('the thread from the held ＋ to Cashflow’s One line field', () => {
  it('opens nothing while no Cashflow has registered', () => {
    expect(openCashflowLine()).toBe(false);
  });

  it('calls the registered opener, and stops once it is taken back', () => {
    const open = vi.fn();
    const release = registerLineOpener(open);
    expect(openCashflowLine()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    release();
    expect(openCashflowLine()).toBe(false);
  });

  it('closes the field when Cashflow goes, so the tab bar comes back', () => {
    const release = registerLineOpener(() => setLineState({ open: true }));
    openCashflowLine();
    setLineState({ day: '2026-11-11', flashId: 'tx-1' });
    expect(lineState()).toEqual({ open: true, day: '2026-11-11', flashId: 'tx-1' });
    release();
    expect(lineState()).toEqual({ open: false, day: null, flashId: null });
  });

  it('a stale release does not take away a newer Cashflow’s opener', () => {
    const first = registerLineOpener(() => {});
    const second = vi.fn();
    registerLineOpener(second);
    first();
    expect(openCashflowLine()).toBe(true);
    expect(second).toHaveBeenCalled();
  });

  it('tells its listeners only when something changed', () => {
    const heard = vi.fn();
    const stop = subscribeLine(heard);
    setLineState({ open: true });
    setLineState({ open: true });
    expect(heard).toHaveBeenCalledTimes(1);
    setLineState({ open: false });
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    setLineState({ open: true });
    expect(heard).toHaveBeenCalledTimes(2);
    setLineState({ open: false });
  });
});
