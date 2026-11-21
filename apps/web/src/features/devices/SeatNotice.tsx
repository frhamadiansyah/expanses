import { useApp } from '../../app/context';
import { Notice } from '../../ui/native';
import { useSharedBooks } from '../sharing/queries';
import { useOpenBook } from '../workspaces/queries';
import { seatBody, seatTitle } from './devices-copy';
import { useSelfStatus } from './use-self';

/**
 * Link my devices (owner answer 1): above every screen of a workspace shared with someone else, on a linked device
 * that is not the one keeping it shared — view-only here; adding and editing happen on that device. Capture refuses a
 * write all the same (`SeatElsewhereError`); the screen says so before anyone tries.
 */
export function SeatNotice() {
  const { ws, sync } = useApp();
  const status = useSelfStatus();
  const shared = useSharedBooks().data ?? [];
  const current = useOpenBook();
  if (!sync.elsewhere) return null;
  const book = shared.find((each) => each.bookId === ws.bookId && each.state === 'active');
  if (!book) return null;
  const seat = status.devices.find((d) => d.deviceId === status.seatId)?.name ?? 'the other device';
  const partners = book.members.filter((m) => m.memberId !== book.memberId).map((m) => m.name);
  return <Notice testId="seat-notice" kind="info" title={seatTitle(seat)} line={seatBody(current?.name ?? 'This workspace', partners, seat)} />;
}
