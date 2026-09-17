export interface WorkspaceContext {
  workspaceId: string;
  baseCurrency: string;
  /**
   * The set of books being read or written, when there is more than one. Absent, book-scoped queries read the whole
   * workspace, exactly as before books existed — which is what every owner-level query does regardless.
   */
  bookId?: string;
}

export const inBook = (ws: WorkspaceContext, bookId: string): WorkspaceContext => ({ ...ws, bookId });

// Owner-level reads — cards, points, events, net worth — ignore the open book.
export const ownerScope = (ws: WorkspaceContext): WorkspaceContext => ({ workspaceId: ws.workspaceId, baseCurrency: ws.baseCurrency });
