import { AfterUpdateCard } from '../features/backup/AfterUpdateCard';
import { BackupBanner } from '../features/backup/BackupBanner';
import { WithdrawalRateNotice } from '../features/accounts/WithdrawalRateNotice';
import { InstallHint } from '../features/pwa/InstallHint';
import { SeatNotice } from '../features/devices/SeatNotice';
import { ReadOnlyNotice } from '../features/sharing/ReadOnlyNotice';
import { RepairNotice } from '../features/sharing/RepairNotice';
import { NoticeStrip } from '../ui/native';
import { usePhone, useSideways } from './use-phone';

/**
 * The app's own notices, in the order they are read: what just happened to the data before the standing reminder to back it up.
 * `backup: false` leaves the reminder out, on a page that is the backup itself (Settings › Backup).
 */
export function AppNotices({ backup = true }: { backup?: boolean } = {}) {
  return (
    <>
      <InstallHint />
      <AfterUpdateCard />
      <WithdrawalRateNotice />
      {backup && <BackupBanner />}
      {/* A share that ended here is read-only (§8.6), and every screen of it says so. */}
      <ReadOnlyNotice />
      {/* A workspace shared with someone, on a linked device that is not the one keeping it shared: view-only here. */}
      <SeatNotice />
      {/* Once: Family purchases the shared-book repair put right (sync gaps R2). */}
      <RepairNotice />
    </>
  );
}

/**
 * The app's notices on a Mac page that draws its own title bar (`edgeToEdge`): slim strips right under that bar, so the
 * bar is the window's top edge and nothing sits above it. Each keeps its own press, alert and ✕. The page draws this
 * under its header; Layout leaves its own copy out for those pages. A phone never draws it: its notices stay where they were.
 */
export function DeskNotices({ backup = true, column = false }: { backup?: boolean; column?: boolean } = {}) {
  const phone = usePhone();
  const sideways = useSideways();
  if (phone || sideways) return null;
  return (
    // Above a column screen's own title bar, the notices start below the Mac window's title strip.
    <div data-testid="desk-notices" className={column ? 'mk-col-notices' : undefined}>
      <NoticeStrip.Provider value={true}>
        <AppNotices backup={backup} />
      </NoticeStrip.Provider>
    </div>
  );
}
