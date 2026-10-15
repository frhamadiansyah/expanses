import type { SharedBookSummary } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { workspaceBooks } from './workspace-books';

const book = (bookId: string, kind: SharedBookSummary['kind']): SharedBookSummary => ({ bookId, relayBookId: `r-${bookId}`, state: 'active', memberId: 'm', members: [], unsharedBy: null, unsharedReason: null, kind });

describe('the shared workspaces', () => {
  it('leave a shared event’s book out', () => {
    expect(workspaceBooks([book('w1', 'workspace'), book('e1', 'event'), book('w2', 'workspace')]).map((b) => b.bookId)).toEqual(['w1', 'w2']);
  });
});
