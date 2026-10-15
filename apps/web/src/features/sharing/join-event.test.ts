import { describe, expect, it } from 'vitest';
import { joinChoices } from './join-event';

describe('joining an event (§6)', () => {
  it('offers each name not yet claimed as "I’m …", then a new name', () => {
    expect(
      joinChoices({ name: 'Coast week', startsOn: '2026-10-05', endsOn: '2026-10-12', currency: 'TRY', minAppVersion: '0.4.0', people: [
        { personId: 'p-budi', name: 'Budi', claimed: false },
        { personId: 'p-rina', name: 'Rina', claimed: true },
        { personId: 'p-dewi', name: 'Dewi', claimed: false },
      ] }),
    ).toEqual([
      { key: 'p-budi', label: 'I’m Budi', personId: 'p-budi', name: 'Budi' },
      { key: 'p-dewi', label: 'I’m Dewi', personId: 'p-dewi', name: 'Dewi' },
      { key: 'new', label: 'Someone new', personId: null, name: '' },
    ]);
  });
});
