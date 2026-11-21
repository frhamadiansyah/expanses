import { Sheet } from '../../app/Sheet';
import { InsetGroup, InsetRow } from '../../ui/native';

/** Unlink …? — the one confirm before a device stops getting anything (mockup 2026-11-21 step 4), phone and Mac alike. */
export function UnlinkSheet({ deviceName, hereName, onUnlink, onClose }: { deviceName: string; hereName: string; onUnlink: () => void; onClose: () => void }) {
  return (
    <Sheet grouped title={`Unlink ${deviceName}?`} onClose={onClose}>
      <p className="mb-5 text-center text-[14px] text-[var(--ph-ink-3)]">It gets nothing written from now on. The data on this {hereName} stays.</p>
      <InsetGroup wide>
        <InsetRow destructive testId="device-unlink-confirm" title="Unlink" onClick={onUnlink} />
      </InsetGroup>
      <InsetGroup wide>
        <InsetRow action title="Cancel" onClick={onClose} />
      </InsetGroup>
    </Sheet>
  );
}
