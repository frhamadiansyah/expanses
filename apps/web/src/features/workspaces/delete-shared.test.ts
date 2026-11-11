import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LastOwnerError, LeaveIncompleteError, SyncTransportError } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { stringLiterals } from '../../lib/string-literals';
import {
  arrivingLine,
  DELETE_HERE_ONLY_ASK,
  DELETE_HERE_ONLY_LABEL,
  JOIN_FIRST_WARNING,
  deleteCopyConfirm,
  deleteRefusal,
  deleteStep,
  KEEP_LABEL,
  LAST_OWNER_LINE,
  leaveDeleteConfirm,
  leaveDeleteTitle,
  leaveNeedsConnection,
  NOT_SENT_NOTE,
  ownPurchasesLine,
  ownRecordsLine,
} from './delete-shared';

/*
 * What Delete says for a workspace that is or was shared (sharing resilience spec §5.1, D-A8, D-A9; owner decision
 * Q1: own purchases are kept in Personal by default).
 */

const plan = (over: Partial<Parameters<typeof deleteRefusal>[0]> = {}) => ({
  refusal: null,
  refusalCode: null,
  ownRecords: 0,
  ...over,
});

describe('Leave and delete (D-A8)', () => {
  it('asks in §5.1’s words when nothing paid from this phone’s accounts is kept', () => {
    expect(leaveDeleteTitle('Home')).toBe('Leave and delete Home?');
    expect(leaveDeleteConfirm({ bookName: 'Home', others: ['Dewi'], keep: false, ownPurchases: 4 })).toBe(
      "This phone leaves the share and Home is removed from this phone: every purchase, category and plan in it. Purchases paid from accounts on this phone leave those accounts' balances. Dewi's copy is not changed. A safety copy is taken first.",
    );
    expect(leaveDeleteConfirm({ bookName: 'Home', others: ['Dewi'], keep: true, ownPurchases: 0 })).toBe(
      "This phone leaves the share and Home is removed from this phone: every purchase, category and plan in it. Purchases paid from accounts on this phone leave those accounts' balances. Dewi's copy is not changed. A safety copy is taken first.",
    );
  });

  it('says the kept purchases keep their balances while Keep them in Personal is on', () => {
    expect(leaveDeleteConfirm({ bookName: 'Home', others: ['Dewi'], keep: true, ownPurchases: 4 })).toBe(
      "This phone leaves the share and Home is removed from this phone: every purchase, category and plan in it. Purchases paid from accounts on this phone move to Personal, so those accounts' balances stay as they are. Dewi's copy is not changed. A safety copy is taken first.",
    );
  });

  it('names every other copy, or none', () => {
    expect(leaveDeleteConfirm({ bookName: 'Home', others: ['Dewi', 'Budi'], keep: false, ownPurchases: 0 })).toContain('The copies of Dewi and Budi are not changed.');
    expect(leaveDeleteConfirm({ bookName: 'Home', others: [], keep: false, ownPurchases: 0 })).toContain('No other copy is changed.');
  });

  it('offers Delete here only when the relay cannot be reached, and nothing but the owner step for the last owner', () => {
    expect(leaveNeedsConnection(new SyncTransportError(0, 'relay unreachable: Failed to fetch'))).toBe(true);
    expect(leaveNeedsConnection(new SyncTransportError(503, 'unavailable'))).toBe(true);
    expect(leaveNeedsConnection(new TypeError('Failed to fetch'))).toBe(true);
    expect(leaveNeedsConnection(new LeaveIncompleteError(new SyncTransportError(0, 'relay unreachable')))).toBe(true);
    expect(leaveNeedsConnection(new SyncTransportError(403, 'removed'))).toBe(false);
    expect(leaveNeedsConnection(new SyncTransportError(410, 'gone'))).toBe(false);
    expect(leaveNeedsConnection(new LastOwnerError('last owner'))).toBe(false);
    expect(leaveNeedsConnection(new Error('disk full'))).toBe(false);
    expect(DELETE_HERE_ONLY_ASK).toBe('Leaving needs a connection. Delete here only? The share will still list this phone until an owner removes it.');
    expect(DELETE_HERE_ONLY_LABEL).toBe('Delete here only');
    expect(LAST_OWNER_LINE).toBe('Make someone else an owner first.');
    expect(deleteStep(new LastOwnerError('x'))).toBe('last-owner');
    expect(deleteStep(new SyncTransportError(0, 'relay unreachable'))).toBe('here-only');
    expect(deleteStep(new Error('disk full'))).toBe('error');
  });
});

describe('Delete of a copy that is no longer shared (D-A8, D-A9)', () => {
  it('says what goes and what stays', () => {
    expect(deleteCopyConfirm({ bookName: 'Home', keep: true, ownPurchases: 2 })).toBe(
      "Home is removed from this phone: every purchase, category and plan in it. Purchases paid from accounts on this phone move to Personal, so those accounts' balances stay as they are. No other copy is changed. A safety copy is taken first.",
    );
    expect(deleteCopyConfirm({ bookName: 'Home', keep: false, ownPurchases: 2 })).toBe(
      "Home is removed from this phone: every purchase, category and plan in it. Purchases paid from accounts on this phone leave those accounts' balances. No other copy is changed. A safety copy is taken first.",
    );
  });

  it('counts what moves, what is kept and what comes back, from the plan', () => {
    expect(ownPurchasesLine(1, true)).toBe('1 purchase paid from own accounts moves to Personal');
    expect(ownPurchasesLine(3, true)).toBe('3 purchases paid from own accounts move to Personal');
    expect(ownPurchasesLine(3, false)).toBe("3 purchases paid from own accounts are erased, and those accounts' balances change");
    expect(ownRecordsLine(1)).toBe('1 trade or sale is kept in Personal');
    expect(ownRecordsLine(2)).toBe('2 trades or sales are kept in Personal');
    expect(arrivingLine(1, 'Home · joined today')).toBe('1 purchase will come back with Place them now on Home · joined today');
    expect(arrivingLine(5, null)).toBe('5 purchases will come back with Place them now on the new share');
    expect(JOIN_FIRST_WARNING).toBe('Join the new share first; purchases it brings back would otherwise be counted twice.');
    expect(KEEP_LABEL).toBe('Keep them in Personal');
    expect(NOT_SENT_NOTE).toBe('What is kept stays on this phone in Personal. It is not sent to anyone, even when Personal is shared.');
  });

  it('refuses in the plan’s words, and with keep off when own trades or sales are in it', () => {
    expect(deleteRefusal(plan(), true)).toBeNull();
    expect(deleteRefusal(plan({ refusal: 'A purchase is split.', refusalCode: 'SPLIT' }), true)).toBe('A purchase is split.');
    expect(deleteRefusal(plan({ refusal: 'N transactions…', refusalCode: 'RECORDS' }), true)).toBe('N transactions…');
    // Leave and delete is asked on an active copy, which the plan refuses only until the leave.
    expect(deleteRefusal(plan({ refusal: 'Leave and delete it, or leave it first.', refusalCode: 'SHARED' }), true, { leaving: true })).toBeNull();
    expect(deleteRefusal(plan({ ownRecords: 2 }), true)).toBeNull();
    expect(deleteRefusal(plan({ ownRecords: 2 }), false)).toBe(
      "2 trades or sales in this workspace hold money of this phone's own accounts and cannot be erased. Delete it with Keep them in Personal on.",
    );
  });
});

describe('no string Delete shows speaks to the reader as "you"', () => {
  it('holds for every string literal in delete-shared.ts', () => {
    const source = readFileSync(fileURLToPath(new URL('./delete-shared.ts', import.meta.url)), 'utf8');
    const strings = stringLiterals(source);
    expect(strings.length).toBeGreaterThan(15);
    for (const text of strings) expect(text, text).not.toMatch(/\b(you|your|my)\b/i);
  });
});
