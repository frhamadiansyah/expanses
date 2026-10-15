import { formatMinor } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { tripSubtitle } from './trip-rows';

describe('a trip on the Debts page', () => {
  it('lists the payments this person is in, by name', () => {
    expect(tripSubtitle({ eventId: 'e', name: 'Coast week', currency: 'TRY', balanceMinor: 480_000, payments: [
      { fromPersonId: 'a', fromName: 'Andi', toPersonId: 'r', toName: 'Rina', amountMinor: 290_000 },
      { fromPersonId: 'b', fromName: 'Budi', toPersonId: 'r', toName: 'Rina', amountMinor: 190_000 },
    ] })).toBe(`Andi pays Rina ${formatMinor(290_000, 'TRY')} · Budi pays Rina ${formatMinor(190_000, 'TRY')}`);
    expect(tripSubtitle({ eventId: 'e', name: 'Coast week', currency: 'TRY', balanceMinor: 0, payments: [] })).toBe('Settled');
  });

  it('adds how many records are not in the books yet', () => {
    const base = { eventId: 'e', name: 'Coast week', currency: 'TRY', balanceMinor: 0, payments: [] };
    expect(tripSubtitle({ ...base, waitingCount: 2 })).toBe('Settled · 2 not in the books yet');
    expect(tripSubtitle({ ...base, waitingCount: 0 })).toBe('Settled');
  });
});
