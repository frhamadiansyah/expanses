import type { SelfDeviceRow } from '@expanses/db';
import { syncedAgo } from '../sharing/sharing-copy';

/*
 * Link my devices: the Devices screens' words (mockups 2026-11-19 and 2026-11-21). Impersonal, as every line of the app:
 * never "you". Pure, so the words are tested where they are made.
 */

export const DEVICES_TITLE = 'Devices';
export const LINK_ANOTHER = 'Link another device';
export const LINK_ANOTHER_FOOTER = 'Every workspace, private ones too. A workspace made later goes to every device by itself.';
export const LINK_TO_ANOTHER = 'Link to another device';
export const LINK_TO_ANOTHER_SUB = 'Bring over everything from an iPhone, iPad or Mac';
export const UNLINKED_TITLE = 'Unlinked from this data';
export const UNLINKED_BODY = 'Another device unlinked this one. Nothing new comes here; what is here stays.';
export const JOIN_FAILED_TITLE = 'Linking did not finish';
export const JOIN_FAILED_BODY = "This device's data is as it was. Link again from the other device to try once more.";
export const LINKED_TITLE = 'Linked';
export const UNLINK_FOOTER = 'A lost or sold device. It stops getting anything new; what it holds stays on it.';

/** "MacBook Air" — "this device · synced just now", or a device's last sync. */
export function deviceLine(device: SelfDeviceRow, now: number): string {
  if (device.removedAt) return 'unlinked';
  const synced = syncedAgo(device.lastSyncedAt ? Date.parse(device.lastSyncedAt) : null, now);
  return device.thisDevice ? `this device · ${synced}` : synced;
}

/** The devices still holding this data, this one first. */
export function linkedDevices(devices: readonly SelfDeviceRow[]): SelfDeviceRow[] {
  return devices.filter((d) => d.removedAt === null).sort((a, b) => Number(b.thisDevice) - Number(a.thisDevice) || a.addedAt.localeCompare(b.addedAt));
}

/** "on 2 devices", and who else it is shared with when it is. */
export function workspaceLine(devices: number, sharedWith: readonly string[]): string {
  const on = devices === 1 ? 'on this device' : `on ${devices} devices`;
  return sharedWith.length > 0 ? `${on} · shared with ${namesOf(sharedWith)}` : on;
}

export function namesOf(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The source's question, once the new device has answered with its keys. */
export function allowTitle(deviceName: string): string {
  return `Link ${deviceName}?`;
}

export function allowBody(deviceName: string, sourceName: string): string {
  return `${deviceName} will get every workspace on this ${sourceName}, private ones too.`;
}

/** The new device's warning before anything happens, when it already holds data. */
export function replaceWarning(input: { deviceName: string; workspaces: number; transactions: number; sourceHint: string }): string {
  const what = input.workspaces === 1 ? '1 workspace' : `${input.workspaces} workspaces`;
  return `This ${input.deviceName} already holds data (${what}, ${input.transactions} transactions). Linking replaces it with the ${input.sourceHint}'s. A backup file of this ${input.deviceName} is saved first.`;
}

/** A device that shares a workspace with someone else keeps it: it shows a code, it never takes one. */
export function sharesHere(deviceName: string, names: readonly string[]): string {
  return `This ${deviceName} shares ${namesOf(names)} with someone, so it shows a code instead of typing one. Link from it: Account › Devices › Link another device.`;
}

/** A shared workspace on a linked device that is not the seat (owner answer 1). */
export function seatTitle(seatName: string): string {
  return `Changed on ${seatName}`;
}

export function seatBody(workspace: string, partners: readonly string[], seatName: string): string {
  const withWhom = partners.length > 0 ? ` with ${namesOf(partners)}` : '';
  return `${workspace} is shared${withWhom} from the ${seatName}. Here it can be looked at; adding and editing happen on the ${seatName}.`;
}

export function partsLine(done: number, total: number): string {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return `${pct}%`;
}

/** While receipt photos follow the figures (mockup: "Photos of receipts after the figures"). */
export function photosLine(missing: number): string {
  return missing === 1 ? '1 photo of a receipt still to arrive.' : `${missing} photos of receipts still to arrive.`;
}
