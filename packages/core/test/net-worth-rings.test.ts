import { describe, expect, it } from 'vitest';
import { isRingColour, parseRingPick, RING_COLOURS, resolveRings, takenRings } from '../src';

const RINA = 'm-rina';
const ANDI = 'm-andi';
const BUDI = 'm-budi';

describe('RING_COLOURS', () => {
  it('is the palette in its order, with no red, rose or green', () => {
    expect(RING_COLOURS).toEqual(['blue', 'purple', 'teal', 'indigo', 'orange', 'brown', 'magenta']);
    expect(isRingColour('teal')).toBe(true);
    expect(isRingColour('red')).toBe(false);
    expect(isRingColour(3)).toBe(false);
  });
});

describe('resolveRings', () => {
  it('with no picks, each member keeps the colour of their place in the group, as before', () => {
    expect(resolveRings([RINA, ANDI], {})).toEqual({ [RINA]: 'blue', [ANDI]: 'purple' });
    expect(resolveRings([ANDI, RINA, BUDI], {})).toEqual({ [ANDI]: 'blue', [RINA]: 'purple', [BUDI]: 'teal' });
  });

  it('a pick replaces the member’s default; the other keeps theirs', () => {
    expect(resolveRings([RINA, ANDI], { [RINA]: { colour: 'teal', at: '2026-11-12T01:00:00.000Z' } })).toEqual({ [RINA]: 'teal', [ANDI]: 'purple' });
  });

  it('two members never share one colour: the earlier pick wins, the other falls back to the first free colour', () => {
    const picks = {
      [RINA]: { colour: 'teal', at: '2026-11-12T01:00:00.000Z' },
      [ANDI]: { colour: 'teal', at: '2026-11-12T01:00:05.000Z' },
    } as const;
    expect(resolveRings([RINA, ANDI], picks)).toEqual({ [RINA]: 'teal', [ANDI]: 'blue' });
    // The same on every phone, whatever order the phone lists the members or the picks in.
    expect(resolveRings([RINA, ANDI], { [ANDI]: picks[ANDI], [RINA]: picks[RINA] })).toEqual({ [RINA]: 'teal', [ANDI]: 'blue' });
  });

  it('picks made at the same moment: the lower member id wins, on every phone', () => {
    const at = '2026-11-12T01:00:00.000Z';
    expect(resolveRings([RINA, ANDI], { [RINA]: { colour: 'orange', at }, [ANDI]: { colour: 'orange', at } })).toEqual({ [ANDI]: 'orange', [RINA]: 'blue' });
    expect(resolveRings([ANDI, RINA], { [ANDI]: { colour: 'orange', at }, [RINA]: { colour: 'orange', at } })).toEqual({ [ANDI]: 'orange', [RINA]: 'blue' });
  });

  it('orders picks by the bytes of their time, not a locale’s collation, and puts a malformed time last', () => {
    // Lower case sorts after upper case in byte order; a collation might put them together. Only byte order is the same everywhere.
    const odd = { [RINA]: { colour: 'indigo', at: 'zzz-not-a-time' }, [ANDI]: { colour: 'indigo', at: '2026-11-12T09:00:00.000Z' } } as const;
    expect(resolveRings([RINA, ANDI], odd)).toEqual({ [ANDI]: 'indigo', [RINA]: 'blue' });
    expect(resolveRings([ANDI, RINA], odd)).toEqual({ [ANDI]: 'indigo', [RINA]: 'blue' });
    // Two malformed times: still settled the same way on every phone, by member id.
    const both = { [RINA]: { colour: 'indigo', at: 'b' }, [ANDI]: { colour: 'indigo', at: 'A' } } as const;
    expect(resolveRings([RINA, ANDI], both)).toEqual({ [ANDI]: 'indigo', [RINA]: 'blue' });
    // Two good times compare by their bytes: the earlier wins.
    const close = { [RINA]: { colour: 'indigo', at: '2026-11-12T09:00:00.001Z' }, [ANDI]: { colour: 'indigo', at: '2026-11-12T09:00:00.010Z' } } as const;
    expect(resolveRings([ANDI, RINA], close)).toEqual({ [RINA]: 'indigo', [ANDI]: 'blue' });
  });

  it('a pick beats a default it lands on; the default moves to the first free colour', () => {
    // Rina never picked (blue by place); Andi picked blue: Andi's choice stands, Rina takes the first free one.
    expect(resolveRings([RINA, ANDI], { [ANDI]: { colour: 'blue', at: '2026-11-12T01:00:00.000Z' } })).toEqual({ [ANDI]: 'blue', [RINA]: 'purple' });
  });

  it('a race loser never takes a colour another member holds by default', () => {
    const picks = {
      [RINA]: { colour: 'blue', at: '2026-11-12T01:00:00.000Z' },
      [ANDI]: { colour: 'blue', at: '2026-11-12T02:00:00.000Z' },
    } as const;
    // Budi (third, teal by place) keeps teal; Andi, who lost blue, takes purple, the first colour nobody holds.
    expect(resolveRings([RINA, ANDI, BUDI], picks)).toEqual({ [RINA]: 'blue', [ANDI]: 'purple', [BUDI]: 'teal' });
  });

  it('ignores a pick by someone not in the group', () => {
    expect(resolveRings([RINA, ANDI], { 'm-gone': { colour: 'blue', at: '2026-11-12T00:00:00.000Z' } })).toEqual({ [RINA]: 'blue', [ANDI]: 'purple' });
  });

  it('more members than colours: the palette goes round again rather than leaving anyone without one', () => {
    const members = Array.from({ length: 9 }, (_, i) => `m-${i}`);
    const rings = resolveRings(members, {});
    expect(Object.values(rings)).toEqual([...RING_COLOURS, 'blue', 'purple']);
  });
});

describe('takenRings', () => {
  it('names the colour each other member holds, never one’s own', () => {
    expect(takenRings([RINA, ANDI], { [RINA]: { colour: 'teal', at: '2026-11-12T01:00:00.000Z' } }, RINA)).toEqual({ purple: ANDI });
    expect(takenRings([RINA, ANDI], {}, ANDI)).toEqual({ blue: RINA });
  });
});

describe('parseRingPick', () => {
  it('reads a pick, and nothing from what a newer or broken build might send', () => {
    expect(parseRingPick('{"colour":"teal","at":"2026-11-12T01:00:00.000Z","sent":"2026-11-12T01:00:00.000Z"}')).toEqual({ colour: 'teal', at: '2026-11-12T01:00:00.000Z' });
    // A colour a newer build added: no pick here, so the member keeps their default rather than breaking the page.
    expect(parseRingPick('{"colour":"gold","at":"2026-11-12T01:00:00.000Z"}')).toBeNull();
    expect(parseRingPick('{"colour":"teal"}')).toBeNull();
    expect(parseRingPick('not json')).toBeNull();
    expect(parseRingPick(null)).toBeNull();
    expect(parseRingPick('null')).toBeNull();
  });
});
