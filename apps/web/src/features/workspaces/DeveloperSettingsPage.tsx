import { InsetGroup, LargeTitle, SCREEN, SwitchRow } from '../../ui/native';
import { setPreviewEntitlement, useEntitlement } from '../../lib/entitlements';

/**
 * Developer settings — linked from nowhere on purpose, reached by its address (`/settings/developer`). It holds what
 * the owner switches on before the app can sell it: today, the US ticker list (the owner's ruling, 2026-09-21).
 * When store purchases exist, the switch goes and the purchase grants the same entitlement.
 */
export function DeveloperSettingsPage() {
  const foreign = useEntitlement('foreign_securities');
  return (
    <div className={SCREEN}>
      <LargeTitle title="Developer" back="Settings" backTo="/settings" />
      <InsetGroup
        header="Previews"
        footer="On this device only. Turning it off keeps every holding you added from the list; search just stops finding new US tickers."
      >
        <SwitchRow label="US ticker list" hint="The paid list, before purchases exist." checked={foreign} onChange={(on) => setPreviewEntitlement('foreign_securities', on)} />
      </InsetGroup>
    </div>
  );
}
