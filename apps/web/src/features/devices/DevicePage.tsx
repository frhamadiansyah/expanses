import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { UNLINK_FOOTER } from './devices-copy';
import { useSelfStatus } from './use-self';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');

/** Devices › one device (mockup 2026-11-21 step 4): when it was linked, when it last synced, Unlink… */
export function DevicePage() {
  const { deviceId } = useParams({ from: '/account/devices/$deviceId' });
  const { self } = useApp();
  const navigate = useNavigate();
  const status = useSelfStatus();
  const device = status.devices.find((d) => d.deviceId === deviceId) ?? null;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const unlink = async () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      await self.unlink(deviceId);
      await navigate({ to: '/account/devices' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={SCREEN}>
      <PushedTitle title={device?.name ?? 'Device'} back="Devices" backTo="/account/devices" />
      <div className="pt-[2px]" data-testid="device-page">
        <ErrorBox error={error} />
        {device ? (
          <>
            <InsetGroup wide>
              <InsetRow title="Linked" value={day(device.addedAt)} chevron={false} />
              <InsetRow title="Last synced" value={day(device.lastSyncedAt)} chevron={false} />
            </InsetGroup>
            {!device.removedAt && !device.thisDevice && (
              <InsetGroup wide footer={UNLINK_FOOTER}>
                <InsetRow destructive testId="device-unlink" title="Unlink…" disabled={busy} onClick={() => setAsking(true)} />
              </InsetGroup>
            )}
          </>
        ) : (
          <InsetGroup wide>
            <InsetRow title="That device is not linked." chevron={false} />
          </InsetGroup>
        )}
      </div>
      {asking && device && (
        <Sheet grouped title={`Unlink ${device.name}?`} onClose={() => setAsking(false)}>
          <p className="mb-5 text-center text-[14px] text-[var(--ph-ink-3)]">It gets nothing written from now on. The data on this {self.info.name} stays.</p>
          <InsetGroup wide>
            <InsetRow destructive testId="device-unlink-confirm" title="Unlink" onClick={() => void unlink()} />
          </InsetGroup>
          <InsetGroup wide>
            <InsetRow action title="Cancel" onClick={() => setAsking(false)} />
          </InsetGroup>
        </Sheet>
      )}
    </div>
  );
}
