import { PushedTitle, SCREEN } from '../../ui/native';

/** Pay first (spec §4.1): filled in by the next task. */
export function PayFirstPage() {
  return (
    <div className={SCREEN}>
      <PushedTitle title="Pay first" back="Debt-free plan" backTo="/net-worth/plan" />
    </div>
  );
}
