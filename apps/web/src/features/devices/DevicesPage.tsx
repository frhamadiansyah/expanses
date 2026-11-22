import { useQuery } from '@tanstack/react-query';
import { Laptop, Plus, Smartphone, Tablet, MonitorSmartphone } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone, useSideways } from '../../app/use-phone';
import { DesktopSettings } from '../account/DesktopSettings';
import { InsetGroup, InsetRow, Notice, PushedTitle, SCREEN } from '../../ui/native';
import { useSharedBooks } from '../sharing/queries';
import { useBooks } from '../workspaces/queries';
import { LINK_FAILED_KEY } from '../../sync/self-service';
import {
  deviceLine,
  JOIN_FAILED_BODY,
  JOIN_FAILED_TITLE,
  LINK_ANOTHER,
  LINK_ANOTHER_FOOTER,
  LINK_TO_ANOTHER,
  LINK_TO_ANOTHER_SUB,
  linkedDevices,
  photosLine,
  devicesActions,
  UNLINKED_BODY,
  UNLINKED_TITLE,
  workspaceLine,
} from './devices-copy';
import { JoinLinkSheet } from './JoinLinkSheet';
import { clearLinkOnOpen, linkOnOpenWanted } from './link-on-open';
import { LinkSheet } from './LinkSheet';
import { useSelfStatus } from './use-self';

export function deviceIcon(kind: string) {
  if (kind === 'mac') return <Laptop size={16} aria-hidden />;
  if (kind === 'tablet') return <Tablet size={16} aria-hidden />;
  if (kind === 'phone') return <Smartphone size={16} aria-hidden />;
  return <MonitorSmartphone size={16} aria-hidden />;
}

function readFailed(): boolean {
  try {
    return localStorage.getItem(LINK_FAILED_KEY) === '1';
  } catch {
    return false;
  }
}

/** /account/devices: on a wide screen the Mac Settings at Devices, else the phone's Devices page. */
export function DevicesRoute() {
  const phone = usePhone();
  const sideways = useSideways();
  return !phone && !sideways ? <DesktopSettings section="devices" /> : <DevicesPage />;
}

/**
 * What the Devices screens read, the phone's page and the Mac's Settings › Devices alike: the devices holding this data
 * (this one first), what can be done from here, and each workspace with how many devices hold it and who else shares it.
 */
export function useDevicesState() {
  const status = useSelfStatus();
  const books = useBooks();
  const shared = useSharedBooks();
  const [failed, setFailed] = useState(readFailed);
  const devices = linkedDevices(status.devices);
  const unlinked = status.group?.state === 'unlinked';
  const others = devices.filter((d) => !d.thisDevice);
  const count = Math.max(1, devices.length);
  const partners = useQuery({
    queryKey: ['devices-partners', shared.data?.length ?? 0],
    queryFn: () =>
      new Map(
        (shared.data ?? [])
          .filter((book) => book.state === 'active')
          .map((book) => [book.bookId, book.members.filter((m) => m.memberId !== book.memberId).map((m) => m.name)] as const),
      ),
    enabled: shared.isSuccess,
  });
  return {
    status,
    devices,
    others,
    unlinked,
    actions: devicesActions({ unlinked, others: others.length }),
    thisRow: devices.find((d) => d.thisDevice) ?? null,
    workspaces: (books.data ?? []).map((book) => ({ book, line: workspaceLine(count, partners.data?.get(book.id) ?? []) })),
    failed,
    dismissFailed: () => {
      try {
        localStorage.removeItem(LINK_FAILED_KEY);
      } catch {
        // nothing kept
      }
      setFailed(false);
    },
  };
}

/**
 * Account › Devices (mockup 2026-11-19 steps 1–2, Mac "After linking"): every device holding this data, Link another
 * device, the workspaces each on how many devices; on a device with nothing linked, Link to another device as well.
 */
export function DevicesPage() {
  const { self } = useApp();
  const { status, devices, others, unlinked, actions, thisRow, workspaces, failed, dismissFailed } = useDevicesState();
  const [linking, setLinking] = useState(false);
  // Opened from the first screen's Link to another device: the sheet is already showing (link-on-open.ts).
  const [joining, setJoining] = useState(linkOnOpenWanted);
  const now = Date.now();

  return (
    <div className={SCREEN}>
      <PushedTitle title="Devices" back="Account" backTo="/account" />
      <div className="pt-[2px]" data-testid="devices-page">
        {unlinked && <Notice testId="unlinked-notice" kind="info" title={UNLINKED_TITLE} line={UNLINKED_BODY} />}
        {failed && (
          <Notice
            testId="link-failed-notice"
            kind="info"
            title={JOIN_FAILED_TITLE}
            line={JOIN_FAILED_BODY}
            onDismiss={dismissFailed}
          />
        )}
        <InsetGroup wide header={unlinked ? 'This device' : 'This data is on'} footer={!unlinked && status.photosMissing > 0 ? photosLine(status.photosMissing) : undefined}>
          {[
            <InsetRow key="me" icon={deviceIcon(thisRow?.kind ?? self.info.kind)} title={thisRow?.name ?? self.info.name} subtitle={thisRow ? deviceLine(thisRow, now) : others.length === 0 ? 'this device · only copy' : 'this device'} chevron={false} testId="device-this" />,
            ...(unlinked ? [] : others).map((d) => (
              <InsetRow key={d.deviceId} icon={deviceIcon(d.kind)} title={d.name} subtitle={deviceLine(d, now)} to="/account/devices/$deviceId" params={{ deviceId: d.deviceId }} testId="device-other" />
            )),
          ]}
        </InsetGroup>
        {actions.linkAnother && (
          <InsetGroup wide footer={LINK_ANOTHER_FOOTER}>
            <InsetRow icon={<Plus size={16} aria-hidden />} title={LINK_ANOTHER} chevron={false} onClick={() => setLinking(true)} testId="link-another" />
          </InsetGroup>
        )}
        {actions.linkToAnother && (
          <InsetGroup wide>
            <InsetRow icon={<MonitorSmartphone size={16} aria-hidden />} title={LINK_TO_ANOTHER} subtitle={LINK_TO_ANOTHER_SUB} chevron={false} onClick={() => setJoining(true)} testId="link-to-another" />
          </InsetGroup>
        )}
        <InsetGroup wide header="Workspaces">
          {workspaces.map(({ book, line }) => (
            <InsetRow key={book.id} title={book.name} subtitle={line} chevron={false} />
          ))}
        </InsetGroup>
      </div>
      {linking && <LinkSheet onClose={() => setLinking(false)} />}
      {joining && (
        <JoinLinkSheet
          onClose={() => {
            clearLinkOnOpen();
            setJoining(false);
          }}
        />
      )}
    </div>
  );
}
