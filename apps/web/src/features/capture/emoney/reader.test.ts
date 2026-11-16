import { describe, expect, it } from 'vitest';
import type { CardAnswer } from './apdu';
import { type CardLink, readEmoneyCard } from './reader';

// No real card data here: the card number and balance below are invented.

/** A fake card that answers each command from a scripted table, keyed by the command hex. */
function fakeCard(answers: Record<string, CardAnswer>): CardLink {
  return {
    transmit: (apdu) => {
      const answer = answers[apdu];
      if (!answer) throw new Error(`unexpected command ${apdu}`);
      return Promise.resolve(answer);
    },
  };
}

const GOOD = {
  '00A40400080000000000000001': { data: '6F108407', sw: '9000' },
  '00B500000A': { data: '40E20100AABBCCDDEEFF', sw: '9000' }, // 123_456 little-endian
  '00B300003F': { data: '6032980012345670' + '00'.repeat(23), sw: '9000' },
  '00F210000B': { data: '0102030405060708090A0B', sw: '9000' },
};

/** The READ RECORD command for record `nn` of SFI 1, as the reader builds it: 00 B2 nn 0C 00. */
const rec = (nn: number) => `00B2${nn.toString(16).padStart(2, '0').toUpperCase()}0C00`;

describe('reading an e-money card', () => {
  it('selects, then reads the balance and the card number, and keeps every raw answer', async () => {
    // No history on this card: record 1 is refused, so the history read stops at once.
    const read = await readEmoneyCard(fakeCard({ ...GOOD, [rec(1)]: { data: '', sw: '6A83' } }));
    expect(read.balance).toBe(123_456);
    expect(read.cardNumber).toBe('6032980012345670');
    expect(read.note).toBeNull();
    expect(read.history).toEqual([]);
    expect(read.exchanges.slice(0, 4).map((e) => e.label)).toEqual([
      'SELECT e-money application',
      'Balance',
      'Card number',
      'Card attribute',
    ]);
    expect(read.exchanges.every((e) => !e.refused)).toBe(true);
  });

  it('reads records of SFI 1 in order and stops at the first that is not 9000', async () => {
    const read = await readEmoneyCard(
      fakeCard({
        ...GOOD,
        [rec(1)]: { data: '261025143005' + '00030D40', sw: '9000' },
        [rec(2)]: { data: '261024090000' + '00002710', sw: '9000' },
        [rec(3)]: { data: '', sw: '6A83' }, // record not found: the history ends here
      }),
    );
    expect(read.history.map((h) => h.record)).toEqual([1, 2]);
    expect(read.history[0]!.guesses.some((g) => g.includes('2026-10-25 14:30:05'))).toBe(true);
    // Record 3 was asked (and refused by the card) but nothing past it was.
    expect(read.exchanges.some((e) => e.label === 'History record 3')).toBe(true);
    expect(read.exchanges.some((e) => e.label === 'History record 4')).toBe(false);
  });

  it('stops after SELECT when the card is not an e-money card, and says so', async () => {
    const read = await readEmoneyCard(fakeCard({ '00A40400080000000000000001': { data: '', sw: '6A82' } }));
    expect(read.balance).toBeNull();
    expect(read.cardNumber).toBeNull();
    expect(read.note).toMatch(/could not be selected/);
    expect(read.exchanges).toHaveLength(1);
  });

  it('records the card being taken away as a note, not a thrown error', async () => {
    const link: CardLink = {
      transmit: (apdu) => {
        if (apdu === '00A40400080000000000000001') return Promise.resolve({ data: '6F10', sw: '9000' });
        throw new Error('the card was lost');
      },
    };
    const read = await readEmoneyCard(link);
    expect(read.note).toBe('the card was lost');
    expect(read.exchanges).toHaveLength(1);
  });

  it('reports progress for each command, including the first history record it tries', async () => {
    const seen: string[] = [];
    await readEmoneyCard(fakeCard({ ...GOOD, [rec(1)]: { data: '', sw: '6A83' } }), {
      onProgress: (_done, _total, label) => seen.push(label),
    });
    expect(seen).toEqual(['SELECT e-money application', 'Balance', 'Card number', 'Card attribute', 'History record 1']);
  });
});
