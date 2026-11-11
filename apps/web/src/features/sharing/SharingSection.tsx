import type { BookRow } from '@expanses/db';
import { Inbox, Users } from 'lucide-react';
import { useState } from 'react';
import { InsetGroup, InsetRow } from '../../ui/native';
import { PlaceHeldSheet } from './PlaceHeldSheet';
import { useCopyRoles, useLostHere, useShareHealth, useSharingDetail } from './queries';
import { deviceName, heldLine, LOST_LINE, PLACE_LABEL } from './sharing-copy';

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
  // A share this phone lost (sharing resilience §6.2, §7) is said under the row until it is discarded.
  const lost = useLostHere(book.id);
  // Rows of this share another copy here held (§4.4, review I-5): said under the row, with Place them now once that
  // copy is gone — where a delete of the old copy lands.
  const active = detail.data?.state === 'active';
  const health = useShareHealth(book.id).data;
  const held = active ? (health?.held ?? []) : [];
  const roles = useCopyRoles(book.id).data;
  const heldText = heldLine(held.map((row) => ({ holderName: roles?.labels[row.holderBookId] ?? row.holderName, holderExists: row.holderExists, holderStillShared: roles?.stillShared[row.holderBookId] ?? false })));
  const placeable = held.length > 0 && held.every((row) => !row.holderExists);
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<string | null>(null);
  const footer = [lost ? LOST_LINE(book.name) : null, heldText, placed].filter((line): line is string => Boolean(line));
  return (
    <>
    <InsetGroup
      wide
      footer={
        footer.length > 0 ? (
          <span data-testid="ws-share-lines">
            {footer.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        ) : undefined
      }
    >
      <InsetRow
        icon={<Users size={15} aria-hidden />}
        testId="ws-share-row"
        title="Share"
        plain
        value={detail.isPending ? undefined : detail.data ? 'On' : 'Off'}
        to="/account/workspaces/$bookId/share"
        params={{ bookId: book.id }}
      />
      {placeable ? <InsetRow testId="ws-place-row" icon={<Inbox size={15} aria-hidden />} title={PLACE_LABEL} chevron={false} onClick={() => setPlacing(true)} /> : null}
    </InsetGroup>
    {placing ? <PlaceHeldSheet bookId={book.id} onClose={() => setPlacing(false)} onPlaced={setPlaced} /> : null}
    </>
  );
}
