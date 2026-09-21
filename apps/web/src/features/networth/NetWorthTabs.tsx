import { useNavigate, useRouterState } from '@tanstack/react-router';
import { usePhone } from '../../app/use-phone';
import { activeSegment, type Segment, SegmentedControl } from '../../ui/native';

/**
 * The five net-worth sections, as the kit's segmented control.
 *
 * They were an underline tab row, and at 390 px five of them wrapped onto three lines with "Buy & sell" broken
 * across two of them. A segmented control never wraps: `fitSegments` shortens "Buy & sell" first, and only then
 * moves what is left behind the `…`. Four is the most a phone holds, so **Lend & borrow** is the one that moves —
 * the case `/design-kit` demonstrates with these exact five labels.
 *
 * A wide screen has the room for all five, so it is given all five: the desktop loses no control to the phone's
 * limit. The key is the route itself, so which segment is lit is read off the address rather than stored twice —
 * and read as the **longest** matching route, or `/net-worth` would light Overview on every section.
 *
 * Each tab also *names* its route, so each is drawn as a real link: this is the app's main section navigation,
 * and a middle click, a ⌘-click and "open in a new tab" all have to keep working on it. Plain clicking,
 * the keyboard and Back are unchanged — the link is what the browser needs, not a different journey.
 */
const TABS = [
  { key: '/net-worth', label: 'Overview', to: '/net-worth' },
  { key: '/net-worth/assets', label: 'Assets', to: '/net-worth/assets' },
  { key: '/net-worth/trades', label: 'Buy & sell', short: 'Trades', to: '/net-worth/trades' },
  // Debts is everything owed and keeps the Loans page's address; Lend & borrow is the people page, by its own name.
  { key: '/net-worth/loans', label: 'Debts', to: '/net-worth/loans' },
  { key: '/net-worth/lend-borrow', label: 'Lend & borrow', to: '/net-worth/lend-borrow' },
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
  const active = activeSegment(TAB_KEYS, pathname, '/net-worth');

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
