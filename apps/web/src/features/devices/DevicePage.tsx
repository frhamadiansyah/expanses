import { useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone, useSideways } from '../../app/use-phone';
import { DesktopSettings } from '../account/DesktopSettings';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { UNLINK_FOOTER } from './devices-copy';
import { UnlinkSheet } from './UnlinkSheet';
import { useSelfStatus } from './use-self';

export const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '—');

/** /account/devices/$deviceId: on a wide screen the Mac Settings at Devices, showing that device; else the phone's page. */
export function DeviceRoute() {
  const { deviceId } = useParams({ from: '/account/devices/$deviceId' });
  const phone = usePhone();
  const sideways = useSideways();
  return !phone && !sideways ? <DesktopSettings section="devices" device={deviceId} /> : <DevicePage />;
}

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
      {asking && device && <UnlinkSheet deviceName={device.name} hereName={self.info.name} onUnlink={() => void unlink()} onClose={() => setAsking(false)} />}
    </div>
  );
}
