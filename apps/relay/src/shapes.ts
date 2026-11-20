import type { DevicePublic, InviteRecord, LogEntry, Sealed } from '../../../packages/db/src/sync/types';

/*
 * The relay takes JSON from anyone on the internet, so every body is checked for the shape the spec gives it before
 * anything is stored. A body of the wrong shape is a 400. The relay never looks inside `ct`, `sealed` or `sig`.
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSealed(value: unknown): value is Sealed {
  return isObject(value) && typeof value.iv === 'string' && typeof value.ct === 'string';
}

export function isDevicePublic(value: unknown): value is DevicePublic {
  return isObject(value) && isObject(value.signJwk) && isObject(value.agreeJwk);
}

export function isLogEntry(value: unknown): value is LogEntry {
  if (!isObject(value)) return false;
  if (!isText(value.deviceId) || !isText(value.hlc) || typeof value.sig !== 'string') return false;
  if (typeof value.epoch !== 'number' || !Number.isSafeInteger(value.epoch) || value.epoch < 1) return false;
  switch (value.kind) {
    case 'change':
      return typeof value.iv === 'string' && typeof value.ct === 'string';
    case 'removal':
      return isText(value.target);
    case 'rotation':
      return Array.isArray(value.sealed);
    default:
      return false;
  }
}

export function isInviteRecord(value: unknown): value is InviteRecord {
  return (
    isObject(value) &&
    isText(value.inviteId) &&
    isSealed(value.keys) &&
    isSealed(value.preview) &&
    typeof value.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(value.expiresAt)) &&
    typeof value.sameMember === 'boolean' &&
    (value.memberId === undefined || typeof value.memberId === 'string') &&
    typeof value.sig === 'string'
  );
}

export function isOwnersBody(value: unknown): value is { deviceIds: string[] } {
  return isObject(value) && Array.isArray(value.deviceIds) && value.deviceIds.every(isText);
}

/* Link my devices (spec §3.5). */

function isSealedFor(value: unknown): value is { deviceId: string; epoch: number; ephJwk: JsonWebKey; iv: string; ct: string } {
  return isObject(value) && isText(value.deviceId) && typeof value.epoch === 'number' && isObject(value.ephJwk) && typeof value.iv === 'string' && typeof value.ct === 'string';
}

export function isClaimBody(value: unknown): value is { code: string; device: DevicePublic; commit: string } {
  return isObject(value) && typeof value.code === 'string' && isDevicePublic(value.device) && typeof value.commit === 'string';
}

export function isRevealBody(value: unknown): value is { nonce: string; joinerName?: { deviceId: string; epoch: number; ephJwk: JsonWebKey; iv: string; ct: string } } {
  return isObject(value) && typeof value.nonce === 'string' && (value.joinerName === undefined || isSealedFor(value.joinerName));
}

export function isWelcome(value: unknown): value is { deviceId: string; epoch: number; ephJwk: JsonWebKey; iv: string; ct: string } {
  return isSealedFor(value);
}

export function isAckBody(value: unknown): value is { seq: number } {
  return isObject(value) && typeof value.seq === 'number';
}

export function isBlobBody(value: unknown): value is { data: string; expiresAt: string } {
  return isObject(value) && typeof value.data === 'string' && typeof value.expiresAt === 'string';
}
