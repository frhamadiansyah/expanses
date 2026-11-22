import type { SelfDeviceRow } from '@expanses/db';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, Laptop, type LucideIcon, MonitorSmartphone, Plus, Smartphone, Tablet } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { Notice } from '../../ui/native';
import { DESK_BTN, DeskGroup, DeskIcon, DeskRow, PaneTitle } from '../account/desk-rows';
import { BookDevices } from '../sharing/DeskSharing';
import { useSharedBooks } from '../sharing/queries';
import { WorkspaceDot } from '../workspaces/WorkspaceBadge';
import { day } from './DevicePage';
import { useDevicesState } from './DevicesPage';
import {
  deviceLine,
  JOIN_FAILED_BODY,
  JOIN_FAILED_TITLE,
  LINK_ANOTHER,
  LINK_ANOTHER_FOOTER,
  LINK_TO_ANOTHER,
  LINK_TO_ANOTHER_SUB,
  photosLine,
  UNLINK_FOOTER,
  UNLINKED_BODY,
  UNLINKED_TITLE,
} from './devices-copy';
import { JoinLinkSheet } from './JoinLinkSheet';
import { clearLinkOnOpen, linkOnOpenWanted } from './link-on-open';
import { LinkSheet } from './LinkSheet';
import { UnlinkSheet } from './UnlinkSheet';
import { useSelfStatus } from './use-self';

/*
 * The Mac's Settings › Devices (mockup 2026-11-19, Mac "After linking"; 2026-11-21 step 4): what the phone's Account ›
 * Devices reads, drawn as the other Settings sections are — the devices holding this data, Link another device and
 * Link to another device as push buttons opening the phone's own sheets, the workspaces each on how many devices. A
 * device's row opens its own pane here (Linked, Last synced, Unlink…). Under them, each shared workspace's household
 * devices and Sync, as before.
 */

const KIND_ICON: Record<string, LucideIcon> = { mac: Laptop, tablet: Tablet, phone: Smartphone };
const deskIcon = (kind: string) => KIND_ICON[kind] ?? MonitorSmartphone;

/** Unlink…: the confirm, then the device is off this data. `after` runs once it is (the device pane goes back). */
function useUnlink(after?: () => Promise<void> | void) {
  const { self } = useApp();
  const [asking, setAsking] = useState<SelfDeviceRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const unlink = async (device: SelfDeviceRow) => {
    setAsking(null);
    setBusy(true);
    setError(null);
    try {
      await self.unlink(device.deviceId);
      await after?.();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const sheet = asking && <UnlinkSheet deviceName={asking.name} hereName={self.info.name} onUnlink={() => void unlink(asking)} onClose={() => setAsking(null)} />;
  return { ask: setAsking, busy, error, sheet };
}

export function DeskLinkedDevices() {
  const { self } = useApp();
  const { status, others, unlinked, actions, thisRow, workspaces, failed, dismissFailed } = useDevicesState();
  const shared = (useSharedBooks().data ?? []).filter((each) => each.state === 'active');
  const [linking, setLinking] = useState(false);
  // Opened from the first screen's Link to another device: the sheet is already showing (link-on-open.ts).
  const [joining, setJoining] = useState(linkOnOpenWanted);
  const unlink = useUnlink();
  const now = Date.now();

  return (
    <div data-testid="settings-devices">
      <PaneTitle>Devices</PaneTitle>
      {(unlinked || failed) && (
        <div className="mb-[14px] space-y-[8px]">
          {unlinked && <Notice testId="unlinked-notice" kind="info" title={UNLINKED_TITLE} line={UNLINKED_BODY} />}
          {failed && <Notice testId="link-failed-notice" kind="info" title={JOIN_FAILED_TITLE} line={JOIN_FAILED_BODY} onDismiss={dismissFailed} />}
        </div>
      )}
      <DeskGroup title={unlinked ? 'This device' : 'This data is on'} footer={!unlinked && status.photosMissing > 0 ? photosLine(status.photosMissing) : undefined}>
        <DeskRow
          testId="device-this"
          lead={<DeskIcon icon={deskIcon(thisRow?.kind ?? self.info.kind)} tint="#007aff" />}
          title={thisRow?.name ?? self.info.name}
          subtitle={thisRow ? deviceLine(thisRow, now) : others.length === 0 ? 'this device · only copy' : 'this device'}
        />
        {(unlinked ? [] : others).map((device) => (
          <DeskRow
            key={device.deviceId}
            testId="device-other"
            lead={<DeskIcon icon={deskIcon(device.kind)} tint="#8e8e93" />}
            title={device.name}
            subtitle={`linked ${day(device.addedAt)} · ${deviceLine(device, now)}`}
            to="/account/devices/$deviceId"
            params={{ deviceId: device.deviceId }}
            right={
              <button type="button" className={DESK_BTN} disabled={unlink.busy} onClick={() => unlink.ask(device)} data-testid="device-unlink">
                Unlink…
              </button>
            }
          />
        ))}
      </DeskGroup>
      <div className="mb-[12px] empty:hidden">
        <ErrorBox error={unlink.error} />
      </div>
      {(actions.linkAnother || actions.linkToAnother) && (
        <DeskGroup footer={actions.linkAnother ? LINK_ANOTHER_FOOTER : undefined}>
          {actions.linkAnother && (
            <DeskRow
              lead={<DeskIcon icon={Plus} tint="#34c759" />}
              title={LINK_ANOTHER}
              subtitle="An iPhone, iPad or Mac, with a code"
              right={
                <button type="button" className={DESK_BTN} onClick={() => setLinking(true)} data-testid="link-another" aria-label={LINK_ANOTHER}>
                  Link…
                </button>
              }
            />
          )}
          {actions.linkToAnother && (
            <DeskRow
              lead={<DeskIcon icon={MonitorSmartphone} tint="#5856d6" />}
              title={LINK_TO_ANOTHER}
              subtitle={LINK_TO_ANOTHER_SUB}
              right={
                <button type="button" className={DESK_BTN} onClick={() => setJoining(true)} data-testid="link-to-another" aria-label={LINK_TO_ANOTHER}>
                  Link…
                </button>
              }
            />
          )}
        </DeskGroup>
      )}
      <DeskGroup title="Workspaces">
        {workspaces.map(({ book, line }) => (
          <DeskRow key={book.id} lead={<WorkspaceDot book={book} size={24} />} title={book.name} subtitle={line} />
        ))}
      </DeskGroup>
      {shared.map((each) => (
        <BookDevices key={each.bookId} bookId={each.bookId} />
      ))}
      {linking && <LinkSheet onClose={() => setLinking(false)} />}
      {joining && (
        <JoinLinkSheet
          onClose={() => {
            clearLinkOnOpen();
            setJoining(false);
          }}
        />
      )}
      {unlink.sheet}
    </div>
  );
}

/** Settings › Devices › one device: when it was linked, when it last synced, Unlink… — back to Devices once done. */
export function DeskDevicePane({ deviceId }: { deviceId: string }) {
  const navigate = useNavigate();
  const status = useSelfStatus();
  const device = status.devices.find((d) => d.deviceId === deviceId) ?? null;
  const unlink = useUnlink(() => navigate({ to: '/account/devices' }));

  return (
    <div data-testid="device-page">
      <Link to="/account/devices" className="mb-[8px] -ml-[4px] inline-flex items-center text-[13px] text-[var(--mac-accent)] hover:underline">
        <ChevronLeft size={15} aria-hidden />
        Devices
      </Link>
      <PaneTitle>{device?.name ?? 'Device'}</PaneTitle>
      <div className="mb-[12px] empty:hidden">
        <ErrorBox error={unlink.error} />
      </div>
      {device ? (
        <>
          <DeskGroup>
            <DeskRow title="Linked" right={<span>{day(device.addedAt)}</span>} />
            <DeskRow title="Last synced" right={<span>{day(device.lastSyncedAt)}</span>} />
          </DeskGroup>
          {!device.removedAt && !device.thisDevice && (
            <DeskGroup footer={UNLINK_FOOTER}>
              <DeskRow
                title={`Unlink ${device.name}`}
                right={
                  <button type="button" className={DESK_BTN} disabled={unlink.busy} onClick={() => unlink.ask(device)} data-testid="device-unlink">
                    Unlink…
                  </button>
                }
              />
            </DeskGroup>
          )}
        </>
      ) : (
        <DeskGroup>
          <DeskRow quiet title="That device is not linked." />
        </DeskGroup>
      )}
      {unlink.sheet}
    </div>
  );
}
