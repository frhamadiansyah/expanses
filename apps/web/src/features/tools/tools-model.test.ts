import { describe, expect, it } from 'vitest';
import { REACHABLE } from '../../app/nav';
import { findTools, STATEMENT_CHECK, TOOL_GROUPS } from './tools-model';

describe('the Tools page (Mac Settings and Tools, B)', () => {
  it('has the five calculators, then Cards, Money and Tax & data', () => {
    expect(TOOL_GROUPS.map((group) => [group.title, group.tiles.map((tile) => tile.label)])).toEqual([
      ['Calculators', ['Emergency fund', 'Education fund', 'Retirement fund', 'Life cover', 'Loan']],
      ['Cards', ['Which card?', 'Merchants']],
      ['Money', ['Lend & borrow', 'Split a receipt']],
      ['Tax & data', ['Tax report', 'Import', 'Statement check']],
    ]);
  });

  it('opens each calculator straight from its tile, at its own address', () => {
    expect(TOOL_GROUPS[0]!.tiles.map((tile) => tile.to)).toEqual(['/calculators/emergency', '/calculators/education', '/calculators/retirement', '/calculators/life-cover', '/calculators/loan']);
  });

  it('leads only to places the app already has (Statement check asks for an account first)', () => {
    for (const tile of TOOL_GROUPS.slice(1).flatMap((group) => group.tiles)) {
      if (tile.to === null) expect(tile.key).toBe('statement-check');
      else expect(REACHABLE, tile.label).toContain(tile.to);
    }
    expect(STATEMENT_CHECK).toBe('/statement/list');
  });

  it('every tile says in one line what it is for, never "you"', () => {
    for (const tile of TOOL_GROUPS.flatMap((group) => group.tiles)) {
      expect(tile.line.length, tile.label).toBeGreaterThan(10);
      expect(tile.line, tile.label).not.toMatch(/\byou(r|rs)?\b/i);
    }
  });
});

describe('Find a tool', () => {
  const labels = (query: string) => findTools(query).flatMap((group) => group.tiles.map((tile) => tile.label));

  it('is every tile with nothing typed', () => {
    expect(labels('  ')).toHaveLength(12);
  });

  it('matches the name or the line, any case, and drops empty groups', () => {
    expect(labels('loan')).toEqual(['Emergency fund', 'Loan']);
    expect(findTools('CARD').map((group) => group.key)).toEqual(['cards']);
    expect(labels('receipt')).toEqual(['Split a receipt']);
  });

  it('needs every word, in any order', () => {
    expect(labels('fund retirement')).toEqual(['Retirement fund']);
    expect(labels('statement bank')).toEqual(['Import']);
  });

  it('finds nothing for a word no tile holds', () => {
    expect(findTools('zebra')).toEqual([]);
  });
});
