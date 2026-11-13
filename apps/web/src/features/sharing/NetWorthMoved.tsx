import { Navigate, useParams } from '@tanstack/react-router';

/**
 * Share › Net worth, and its Shared list, are gone (2026-11-13): each item is switched in the one list, and the filing
 * is set in the Tax report. A link kept from before lands on the list.
 */
export function NetWorthMoved() {
  const { bookId } = useParams({ strict: false }) as { bookId: string };
  return <Navigate to="/account/workspaces/$bookId/share/what" params={{ bookId }} replace />;
}
