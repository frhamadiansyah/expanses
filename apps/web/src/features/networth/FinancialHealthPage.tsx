import { Settings } from 'lucide-react';
import { useState } from 'react';
import { ErrorBox } from '../../ui';
import { type CornerAction, PushedTitle, SCREEN } from '../../ui/native';
import { HealthRatios } from './HealthRatios';
import type { RatioPeriod } from './health-cards';
import { useHealthInputs } from './use-health';

/**
 * The ratios on a screen of their own, one tap from Net worth's top corner.
 *
 * They were the last section of the Net worth page, under a balance sheet and a chart nobody scrolled past to reach
 * them — a question about how you are doing, sitting under the answer to what you have. iOS keeps a screen like this
 * in the corner rather than at the foot of another screen, and the period they are read over belongs to this screen:
 * `useNetWorthSeries` is the same query the page behind it makes, so the earliest year the switch offers costs no
 * second read.
 *
 * The screen is the period switch and the tiles. What the emergency fund counts, the debt guide and how each ratio
 * is worked out are a Settings page behind the ⚙, as a holding's seldom-changed details are behind its own.
 */
const CORNER: CornerAction[] = [{ key: 'settings', label: 'Settings', glyph: <Settings size={20} aria-hidden />, to: '/net-worth/health/settings' }];

export function FinancialHealthPage() {
  const [period, setPeriod] = useState<RatioPeriod>({ key: 'ttm' });
  const health = useHealthInputs(period);

  return (
    <div className={SCREEN}>
      <PushedTitle title="Financial health" back="Net worth" backTo="/net-worth" actions={CORNER} />
      <ErrorBox error={health.error} />
      <HealthRatios
        flows={health.flows}
        totals={health.totals}
        missing={health.missing}
        jointTotals={health.jointTotals}
        jointMissing={health.jointMissing}
        period={period}
        onPeriod={setPeriod}
        today={health.today}
        earliestYear={health.earliestYear}
      />
    </div>
  );
}
