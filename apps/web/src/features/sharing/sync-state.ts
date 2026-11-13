import { BILL_LINKS_EVERYWHERE, type BookRow, meetsVersion, type SharingDetail, sharingDiagnostics } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { heldLineOf } from './copy-roles';
import { useBookStatus, useCopyRoles, useLostHere, useShareHealth, useSyncStatus } from './queries';
import { forgetConfirm, lastFailedLine, ownersGoneConfirm, shareSilenceLine } from './sharing-copy';
import { type SyncProblem, syncProblemsOf, syncRowValue } from './sync-problems';

/*
 * What the Share page's Sync row and Sync details read (2026-11-13, redesign A1): the problems to fix, and the row's
 * value when there are none. Read from the same queries the Share page read for its boxes and footers before.
 */

export interface SyncState {
  problems: SyncProblem[];
  /** "Up to date", "Syncing…", "3 waiting to send". */
  value: string;
  /** When this device last finished a sync, in ms, or null. */
  lastSynced: number | null;
  /** The share is live here and not frozen: Sync now and invites can run. */
  active: boolean;
  frozen: boolean;
  ownersQuiet: boolean;
  /** Each phone still in the share: whose, its name, its app version, when it was last heard from. */
  phones: { deviceId: string; owner: string; name: string; mine: boolean; version: string | null; seenAt: number | null; outdated: boolean }[];
}

export function useSyncState(book: BookRow, detail: SharingDetail | null): SyncState {
  const { database } = useApp();
  const lost = useLostHere(book.id);
  const live = useSyncStatus(book.id);
  const engineStatus = useBookStatus(book.id);
  const health = useShareHealth(book.id).data;
  const roles = useCopyRoles(book.id).data;
  const diag = useQuery({ queryKey: ['sharing', book.id, 'diagnostics'], queryFn: () => sharingDiagnostics(database, book.id) });
  const now = Date.now();
  const status = engineStatus.data?.status ?? null;
  const frozen = engineStatus.data?.frozen ?? false;
  const active = detail?.state === 'active';
  const ownersQuiet = active && !frozen && (health?.ownersGone.gone ?? false);
  const forgettable = detail !== null && (!active || frozen || ownersQuiet);
  const storedSync = status && 'syncedAt' in status && status.syncedAt ? Date.parse(status.syncedAt) : status?.state === 'stale' ? Date.parse(status.since) : null;
  const lastSynced = live.lastSyncedAt ?? (storedSync !== null && Number.isFinite(storedSync) ? storedSync : null);
  const held = active ? (health?.held ?? []) : [];
  const versions = new Map((diag.data?.devices ?? []).filter((device) => !device.removed).map((device) => [device.deviceId, device.appVersion]));
  const phones = (detail?.members ?? []).flatMap((member) =>
    member.devices.map((device) => {
      const version = versions.get(device.deviceId) ?? null;
      return { deviceId: device.deviceId, owner: member.name, name: device.name, mine: device.mine, version, seenAt: device.seenAt, outdated: !device.mine && !meetsVersion(version, BILL_LINKS_EVERYWHERE) };
    }),
  );
  const ownerNames = (detail?.members ?? []).filter((member) => member.role === 'owner' && !member.me).map((member) => member.name);
  const problems = syncProblemsOf({
    bookName: book.name,
    lost,
    failedLine: live.failing && live.lastError ? lastFailedLine(live.lastError) : null,
    heldText: heldLineOf(held, roles),
    placeable: held.length > 0 && held.every((row) => !row.holderExists),
    holders: roles?.heldBy ?? [],
    forgettable,
    forgetLine: ownersQuiet ? ownersGoneConfirm(book.name, ownerNames, health?.ownersGone.since ?? null) : forgettable ? forgetConfirm(book.name) : null,
    silenceText: active && health ? shareSilenceLine(health.silence, { syncedAt: lastSynced, nowMs: now }) : null,
    outdated: phones.filter((phone) => phone.outdated).map((phone) => ({ name: phone.owner, version: phone.version })),
  });
  return { problems, value: syncRowValue({ running: live.running, waiting: detail?.waiting ?? 0 }), lastSynced, active, frozen, ownersQuiet, phones };
}
