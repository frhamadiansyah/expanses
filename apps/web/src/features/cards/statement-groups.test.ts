import type { CardRow, StatementLine } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { groupStatementLines } from './statement-groups';

const cards: CardRow[] = [
  { id: 'spouse', accountId: 'bonvoy', last4: '8802', holderName: 'Dewi', isPrimary: false },
  { id: 'primary', accountId: 'bonvoy', last4: '1467', holderName: 'Rizky', isPrimary: true },
];

function line(key: string, cardId: string | null, countedMinor: number, spending = true): StatementLine {
  return { key, transactionId: key, occurredOn: '2026-09-01', postedOn: null, statementOn: '2026-09-01', description: key, cardId, owedMinor: countedMinor, countedMinor, instalment: null, convertedTo: null, spending, originalCurrency: null, originalAmountMinor: null, paidBy: null, settles: 0 };
}

describe('groupStatementLines', () => {
  it('keeps a lone card’s statement as one list', () => {
    const groups = groupStatementLines([line('a', null, 100), line('pay', null, -100, false)], [cards[1]!]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ title: null, kind: 'all', totalMinor: 0 });
  });

  it('puts each card’s purchases under it, primary first, then payments, with a section for an unrecorded card', () => {
    const groups = groupStatementLines(
      [line('superindo', 'spouse', 184_000), line('fuel', 'primary', 390_000), line('refund', 'primary', -50_000), line('unknown', null, 20_000), line('payment', null, -2_088_000, false)],
      cards,
    );
    expect(groups.map((group) => [group.title, group.digits, group.lines.map((l) => l.key), group.totalMinor])).toEqual([
      ['Primary', '···· 1467', ['fuel', 'refund'], 340_000],
      ['Supplementary', '···· 8802', ['superindo'], 184_000],
      ['Card not recorded', null, ['unknown'], 20_000],
      ['Payment', null, ['payment'], -2_088_000],
    ]);
  });
});
