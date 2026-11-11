import { useNavigate, useSearch } from '@tanstack/react-router';
import { PushedTitle, SCREEN } from '../../ui/native';
import { ReportPanel } from './ReportPanel';

/** The Report (spec §4.4), `?period=month|3m|year|all`; three months when none is named. */
export function ReportPage() {
  const navigate = useNavigate();
  const { period } = useSearch({ from: '/net-worth/plan/report' });
  return (
    <div className={SCREEN}>
      <PushedTitle title="Report" back="Debt-free plan" backTo="/net-worth/plan" />
      <ReportPanel period={period ?? '3m'} onPeriod={(next) => void navigate({ to: '/net-worth/plan/report', search: { period: next }, replace: true })} />
    </div>
  );
}
