import { describe, expect, it } from 'vitest';
import { seeded } from '../transactions/tx-form';
import { endedText, menuLine, modeFooter, modeHint, opensInEventMode, sharedWithLine, shortDay } from './event-mode';

describe('which ways into the Add screen open in event mode', () => {
  it('the tab bar’s ＋ and an account’s Spend do', () => {
    expect(opensInEventMode({})).toBe(true);
    expect(opensInEventMode({ mode: 'expense' })).toBe(true);
  });

  it('a form that names its own event, item or shared expense does not', () => {
    expect(opensInEventMode({ event: 'e2' })).toBe(false);
    expect(opensInEventMode({ event: 'e2', item: 'i1' })).toBe(false);
    expect(opensInEventMode({ event: 'e2', expense: 'x1' })).toBe(false);
  });

  it('money received, a transfer, a trade or a partner’s item does not', () => {
    expect(opensInEventMode({ mode: 'income' })).toBe(false);
    expect(opensInEventMode({ mode: 'transfer' })).toBe(false);
    expect(opensInEventMode({ mode: 'trade' })).toBe(false);
    expect(opensInEventMode({ partner: 'p1' })).toBe(false);
    expect(opensInEventMode({ to: 'a2' })).toBe(false);
  });
});

describe('the Add form’s seed', () => {
  it('carries the Add in currency and the event', () => {
    expect(seeded({ eventId: 'e1', currency: 'TRY' }, [])).toMatchObject({ eventId: 'e1', currency: 'TRY' });
    expect(seeded({}, [])).not.toHaveProperty('currency');
  });
});

describe('event mode’s words', () => {
  it('says them without addressing anyone', () => {
    const all = [modeHint('Lake trip'), modeFooter('2026-11-20'), menuLine('2026-11-20'), endedText('Lake trip'), sharedWithLine(['Rina', 'Andi'])];
    expect(all).toEqual([
      'New transactions go to Lake trip',
      'Ends by itself after 20 Nov. Turning it on for another event turns this one off.',
      'Event mode until 20 Nov',
      'Event mode for Lake trip ended',
      'Shared with Rina, Andi',
    ]);
    for (const text of all) expect(text).not.toMatch(/\byou(r)?\b/i);
    expect(shortDay('2026-12-01')).toBe('1 Dec');
  });
});
