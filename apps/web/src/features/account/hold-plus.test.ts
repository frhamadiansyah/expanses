import { createDatabase, migrate } from '@expanses/db';
import { createNodeExecutor } from '@expanses/db/node';
import { describe, expect, it } from 'vitest';
import { HOLD_CHOICES, HOLD_PLUS_KEY, holdAction, readHoldChoice, toHoldChoice, writeHoldChoice } from './hold-plus';

async function setup() {
  const executor = createNodeExecutor();
  const database = createDatabase(executor);
  await migrate(database);
  return { database, close: () => executor.close() };
}

describe('what holding ＋ on Cashflow does, kept in the device’s settings', () => {
  it('is One line until something else is chosen', async () => {
    const { database, close } = await setup();
    expect(await readHoldChoice(database)).toBe('line');
    close();
  });

  it('reads back what was written, and the last write wins', async () => {
    const { database, close } = await setup();
    await writeHoldChoice(database, 'menu');
    expect(await readHoldChoice(database)).toBe('menu');
    await writeHoldChoice(database, 'off');
    expect(await readHoldChoice(database)).toBe('off');
    close();
  });

  it('reads a value it does not know as One line', () => {
    expect(toHoldChoice(undefined)).toBe('line');
    expect(toHoldChoice('')).toBe('line');
    expect(toHoldChoice('camera')).toBe('line');
    expect(toHoldChoice('paste')).toBe('paste');
    expect(HOLD_PLUS_KEY).toBe('hold_plus_cashflow');
  });

  it('offers exactly the five choices, One line first', () => {
    expect(HOLD_CHOICES.map((choice) => choice.label)).toEqual(['One line', 'Scan a receipt', 'Paste a list', 'Show the menu', 'Off']);
  });
});

describe('the hold, resolved for the page it is on', () => {
  it('on Cashflow, does the chosen action', () => {
    expect(holdAction('line', '/transactions', false)).toBe('line');
    expect(holdAction('scan', '/transactions', false)).toBe('scan');
    expect(holdAction('paste', '/transactions', false)).toBe('paste');
    expect(holdAction('menu', '/transactions', false)).toBe('menu');
    // Not read yet: a tap, rather than a guess.
    expect(holdAction(undefined, '/transactions', false)).toBe('form');
  });

  it('Off is a tap: the full form', () => {
    expect(holdAction('off', '/transactions', false)).toBe('form');
  });

  it('everywhere else is a tap, whatever is chosen', () => {
    for (const choice of ['line', 'scan', 'paste', 'menu', 'off'] as const) {
      expect(holdAction(choice, '/net-worth', false)).toBe('form');
      expect(holdAction(choice, '/transactions/new', false)).toBe('form');
      expect(holdAction(choice, '/transactions/line', false)).toBe('form');
      expect(holdAction(choice, '/wallet', false)).toBe('form');
    }
  });

  it('a trailing slash is still Cashflow', () => {
    expect(holdAction('line', '/transactions/', false)).toBe('line');
  });

  it('in a read-only workspace a hold is a tap: the form says why nothing can be added', () => {
    expect(holdAction('line', '/transactions', true)).toBe('form');
    expect(holdAction('menu', '/transactions', true)).toBe('form');
  });
});
