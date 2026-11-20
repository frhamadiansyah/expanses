import type { ReactNode } from 'react';
import { AppNotices } from './DeskNotices';

/**
 * The column a page that is not a Mac page is read in on a wide screen. Layout draws `/accounts/$accountId` and
 * `/cards/$cardId` edge to edge for their Mac pages (`edgeToEdge`), so the pages that stay as they were bring the
 * column, and the app's notices, themselves. A phone draws the page as it always has.
 */
export function DeskColumn({ wide, children }: { wide: boolean; children: ReactNode }) {
  if (!wide) return <>{children}</>;
  return (
    <div className="desk-column mx-auto max-w-4xl p-4 md:p-8">
      <AppNotices />
      {children}
    </div>
  );
}
