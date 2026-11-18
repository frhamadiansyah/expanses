import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { WidgetSummary } from '../../native/widget-summary';
import { ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SCREEN, SwitchRow } from '../../ui/native';
import { useSettingsBack } from './settings-desk-model';

/** Settings → Widget: whether the medium home screen widget may show this month's spending. Off by default. */
export function WidgetSettingsPage() {
  const way = useSettingsBack('capture');
  const queryClient = useQueryClient();
  const enabled = useQuery({ queryKey: ['widget-enabled'], queryFn: () => WidgetSummary.getEnabled() });
  const [error, setError] = useState<unknown>(null);

  async function choose(next: boolean) {
    setError(null);
    try {
      await WidgetSummary.setEnabled({ enabled: next });
      await queryClient.invalidateQueries({ queryKey: ['widget-enabled'] });
    } catch (e) {
      setError(e);
    }
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title="Widget" back={way.back} backTo={way.backTo} backSearch={way.backSearch} />
      <ErrorBox error={error ?? enabled.error} />
      <InsetGroup footer="On the medium home screen widget, for the open workspace. Never on the lock screen.">
        <SwitchRow
          label="Show this month's spending on the widget"
          checked={enabled.data?.enabled ?? false}
          disabled={enabled.isPending}
          onChange={(next) => void choose(next)}
          testId="widget-totals-switch"
        />
      </InsetGroup>
    </div>
  );
}
