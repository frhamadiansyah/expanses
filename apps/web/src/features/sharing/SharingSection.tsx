import type { BookRow } from '@expanses/db';
import { Users } from 'lucide-react';
import { InsetGroup, InsetRow } from '../../ui/native';
import { useSharingDetail } from './queries';
import { deviceName } from './sharing-copy';

/*
 * Settings → Workspaces → a workspace → Share. The workspace page carries one row (`ShareRow`: Off or On); the pages it
 * opens are SharePage (the name and the button, then the invite and the members), MemberPage (one member, with what an
 * owner may do to them) and NetWorthPage (the Net worth section below).
 */

const NAME_KEY = 'cicis.sharing.name';

export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // A private window: the name is simply asked for again next time.
  }
}

export const thisDeviceName = () => deviceName(navigator.userAgent, navigator.platform);

/** The workspace page's one row: whether this workspace is shared, and the way into the Share page. */
export function ShareRow({ book }: { book: BookRow }) {
  const detail = useSharingDetail(book.id);
  return (
    <InsetGroup wide>
      <InsetRow
        icon={<Users size={15} aria-hidden />}
        testId="ws-share-row"
        title="Share"
        plain
        value={detail.isPending ? undefined : detail.data ? 'On' : 'Off'}
        to="/account/workspaces/$bookId/share"
        params={{ bookId: book.id }}
      />
    </InsetGroup>
  );
}
