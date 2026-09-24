import { useNavigate, useRouterState } from '@tanstack/react-router';
import { usePhone } from '../../app/use-phone';
import { activeSegment, type Segment, SegmentedControl } from '../../ui/native';

/**
 * The four net-worth sections, as the kit's segmented control.
 *
 * They were an underline tab row, and at 390 px five of them wrapped onto three lines with "Buy & sell" broken
 * across two of them. A segmented control never wraps: `fitSegments` shortens "Buy & sell" first, and only then
 * moves what is left behind the `…`. Four is the most a phone holds, and four is now what there is — **Lend &
 * borrow** left these sections, because lending is not a statement of what you own: it is money moving, and its
 * door is the `⋯` on Cashflow, where the lending happens. The kit still demonstrates the fifth-behind-the-`…` case
 * with its own five labels, on `/design-kit`.
 *
 * The key is the route itself, so which segment is lit is read off the address rather than stored twice — and read
 * as the **longest** matching route, or `/net-worth` would light Overview on every section.
 *
 * Each tab also *names* its route, so each is drawn as a real link: this is the app's main section navigation,
 * and a middle click, a ⌘-click and "open in a new tab" all have to keep working on it. Plain clicking,
 * the keyboard and Back are unchanged — the link is what the browser needs, not a different journey.
 */
const TABS = [
  { key: '/net-worth', label: 'Overview', to: '/net-worth' },
  { key: '/net-worth/assets', label: 'Assets', to: '/net-worth/assets' },
  { key: '/net-worth/trades', label: 'Buy & sell', short: 'Trades', to: '/net-worth/trades' },
  // Debts is everything owed and keeps the Loans page's address.
  { key: '/net-worth/loans', label: 'Debts', to: '/net-worth/loans' },
] as const satisfies readonly Segment[];

type TabPath = (typeof TABS)[number]['key'];

/** The tabs' keys, once: `activeSegment` reads the address against them on every render. */
const TAB_KEYS = TABS.map((tab) => tab.key);

/** The track on a wide screen. Wide enough that every label is drawn in full, none of them shortened. */
const DESKTOP_WIDTH = 640;

export function NetWorthTabs() {
  const navigate = useNavigate();
  const phone = usePhone();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  /**
   * Which section is lit. Lend & borrow has left these sections for Cashflow, so standing on it lights none of
   * them: the fallback to Overview would say the reader is somewhere they are not.
   */
  const ours = pathname === '/net-worth' || TABS.some((tab) => tab.key !== '/net-worth' && pathname.startsWith(tab.key));
  const active = ours ? activeSegment(TAB_KEYS, pathname, '/net-worth') : '';

  return (
    <SegmentedControl
      className="mb-[18px] md:max-w-2xl"
      segments={TABS}
      value={active}
      onChange={(key) => void navigate({ to: key as TabPath })}
      width={phone ? undefined : DESKTOP_WIDTH}
      max={phone ? undefined : TABS.length}
      label="Net worth sections"
    />
  );
}
