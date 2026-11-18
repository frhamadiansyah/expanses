import { useNavigate, useSearch } from '@tanstack/react-router';
import { PushedTitle, SCREEN } from '../../ui/native';
import { usePhone, useSideways } from '../../app/use-phone';
import { DesktopDebtPlan } from './DesktopDebtPlan';
import { ReportPanel } from './ReportPanel';

/** The Report: the Mac plan's Report view on a wide screen, else the phone's page. */
export function ReportPage() {
  const phone = usePhone();
  const sideways = useSideways();
  const { period } = useSearch({ from: '/net-worth/plan/report' });
  if (!phone && !sideways) return <DesktopDebtPlan view="report" period={period} />;
  return <PhoneReportPage />;
}

/** The Report (spec §4.4), `?period=month|3m|year|all`; three months when none is named. */
function PhoneReportPage() {
  const navigate = useNavigate();
  const { period } = useSearch({ from: '/net-worth/plan/report' });
  return (
    <div className={SCREEN}>
      <PushedTitle title="Report" back="Debt-free plan" backTo="/net-worth/plan" />
      <ReportPanel period={period ?? '3m'} onPeriod={(next) => void navigate({ to: '/net-worth/plan/report', search: { period: next }, replace: true })} />
    </div>
  );
}
