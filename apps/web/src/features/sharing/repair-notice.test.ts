import { describe, expect, it } from 'vitest';
import { repairLine, repairRowText, repairTitle } from './repair-notice';

const row = (outcome: 'moved' | 'untagged', why: string | null = null, description = 'Refund · Market') => ({
  transactionId: description + outcome,
  description,
  occurredOn: '2026-10-09',
  eventName: 'Coast week',
  outcome,
  why,
});

describe('the repair notice', () => {
  it('counts what moved and what shows in the workspace again, with no “you”', () => {
    const notice = { bookId: 'b', bookName: 'Family', rows: [row('moved'), row('untagged', 'No USD or TRY rate for 2026-10-06 yet', 'Duty free'), row('untagged', null, 'Cake')] };
    expect(repairTitle(notice)).toBe('3 purchases in Family were tagged to an event without being moved');
    expect(repairLine(notice)).toBe('1 moved into its shared event, 2 show in Family again. The same on both phones now.');
    expect(repairRowText(notice.rows[0]!, 'Family')).toBe('Refund · Market moved into Coast week');
    expect(repairRowText(notice.rows[1]!, 'Family')).toBe('Duty free could not be moved into Coast week: No USD or TRY rate for 2026-10-06 yet. It shows in Family again.');
    expect(repairRowText(notice.rows[2]!, 'Family')).toBe('Cake is no longer tagged to Coast week, and shows in Family again.');
    for (const text of [repairTitle(notice), repairLine(notice), ...notice.rows.map((r) => repairRowText(r, 'Family'))]) expect(text).not.toMatch(/\byour?\b/i);
  });

  it('reads one purchase in the singular', () => {
    const notice = { bookId: 'b', bookName: 'Family', rows: [row('untagged', null)] };
    expect(repairTitle(notice)).toBe('1 purchase in Family was tagged to an event without being moved');
    expect(repairLine(notice)).toBe('1 shows in Family again. The same on both phones now.');
  });
});
