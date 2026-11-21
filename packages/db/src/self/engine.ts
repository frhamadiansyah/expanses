import { sql } from 'drizzle-orm';
import type { Database } from '../database';
import { aesGcmDecrypt, aesGcmEncrypt, AT_REST_INFO, fromUtf8, openSealedKey, randomBytes, sealKeyFor, utf8 } from '../sync/crypto';
import { inviteAad, inviteKeyOf, newInviteSecret, openInviteJson, sealInviteJson, type InviteKey } from '../sync/invite';
import type { DeviceKeys } from '../sync/keys';
import { base64UrlToBytes, bytesToBase64Url, canonicalJson, deviceIdOf, inviteSigningBytes, sha256Hex, verifySignature } from '../sync/relay-signing';
import { type ChangeLogEntry, openChangeSet, sealChangeSet, signEntry, verifyEntry } from '../sync/seal';
import { Sealer } from '../sync/seal';
import type { ChangeSet, InviteRecord, LogEntry, SealedFor } from '../sync/types';
import { SyncTransportError, removedFromBook } from '../sync/types';
import { applySelfChangeSet, collectSelfChanges, dropFromSelfOutbox, selfOutbox, type SelfApplyResult, type SelfChangeSet } from './channel';
import type { LinkView } from './link-hub';
import { checkDigits, commitOf, linkQrText, newNonce, parseLinkCode } from './link-crypto';
import { MAX_BLOB_BYTES, type SelfTransport } from './transport';
import { installSelfCapture, removeSelfCapture } from './triggers';
import { LATEST_VERSION } from '../migrations';
import { localTick } from '../sync/hlc';

/*
 * Link my devices (spec §3.5, §5): the owner's own devices as one group over one relay book.
 *
 * Linking — the device that has the data (source) shows a 6-digit code; the new device types it; both show 4 check
 * digits (link-crypto.ts); on Allow the source hands the new device, sealed for its key, an invite to the group's book.
 * Syncing — each device sends its change-sets (channel.ts) sealed under the group's epoch key, pulls everyone else's,
 * applies them, and acks so the relay can drop what every device has read. Unlinking — any device removes another and
 * seals a new epoch for the rest, so a lost or sold device reads nothing new.
 *
 * The copy a new device starts from goes as blobs (`uploadCopy` / `downloadCopy`); replacing a device's data with it is
 * Drop 3's.
 */

export type DeviceKind = 'phone' | 'tablet' | 'mac' | 'other';

export interface SelfDeviceInfo {
  name: string;
  kind: DeviceKind;
  appVersion: string;
}

export interface SelfGroup {
  relayBookId: string;
  epoch: number;
  cursor: number;
  state: 'active' | 'unlinked';
}

export interface SelfDeviceRow {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  appVersion: string | null;
  addedAt: string;
  lastSyncedAt: string | null;
  removedAt: string | null;
  thisDevice: boolean;
}

export type SourceStage =
  | { stage: 'waiting'; code: string; qr: string; expiresAt: string }
  | { stage: 'confirm'; digits: string; deviceName: string }
  | { stage: 'allowed' }
  | { stage: 'ended'; why: 'expired' | 'burned' | 'declined' | 'mismatch' };

export type JoinStage =
  | { stage: 'waiting' }
  | { stage: 'confirm'; digits: string }
  /** Allowed: the copy is on the relay. The app takes a backup, replaces this device's data with it (`acceptLink`). */
  | { stage: 'allowed' }
  | { stage: 'ended'; why: 'expired' | 'burned' | 'declined' };

export interface SelfSyncResult {
  sent: number;
  applied: number;
  /** A change-set that waits (rule 5's hold, rule 6's newer version): nothing after it is applied until it can be. */
  held?: SelfApplyResult & { status: 'held' };
  /** Another of the owner's devices unlinked this one: it stops syncing, and keeps its data. */
  unlinked?: true;
}

export interface CopyManifest {
  hashes: string[];
  /** The one-off key the copy is sealed under, base64url; it travels only inside a sealed welcome or change-set. */
  key: string;
  bytes: number;
  sha256: string;
}

/** What the source hands the new device on Allow, sealed for its key. */
interface Welcome {
  relayBookId: string;
  inviteId: string;
  secret: string;
  copy: CopyManifest;
  /** The source's data version and app version: a device older than the copy does not take it. */
  schema: number;
  appVersion: string;
}

/** The bytes the source signs for a welcome: the session, the new device, and the sealed welcome itself. */
function welcomeSigningBytes(sessionId: string, joinerId: string, welcome: SealedFor): Uint8Array {
  const { sig: _sig, ...sealed } = welcome as SealedFor & { sig?: string };
  return utf8(canonicalJson({ v: 'cicis-link-welcome-v1', sessionId, joinerId, welcome: sealed }));
}

/**
 * Everything the new device needs to become a device of the group once its data is the copy: kept by the app across
 * the replace (it lives outside the database), applied by `completeLinkedCopy` at the next open.
 */
export interface JoinPlan {
  deviceId: string;
  relayBookId: string;
  epoch: number;
  startSeq: number;
  /** The group's epoch keys, sealed at rest for this device's own key (never in the clear outside the database). */
  keys: { epoch: number; sealedJson: string }[];
  copy: CopyManifest;
}

/** The settings key naming the seat: the one of the owner's devices that keeps shared workspaces in step (§3.4). */
export const SEAT_KEY = 'self.seat';

export class SelfError extends Error {
  constructor(
    readonly code: 'NOT_LINKED' | 'UNLINKED' | 'ALREADY_LINKED' | 'BAD_CODE' | 'MISMATCH' | 'NO_KEY' | 'LAST_DEVICE' | 'NEWER_SOURCE',
    message: string,
  ) {
    super(message);
    this.name = 'SelfError';
  }
}

/** The local id the group's book is sealed under (its epoch keys at rest, every entry's binding). */
export const selfBookId = (relayBookId: string) => `self:${relayBookId}`;
const COPY_TTL_MS = 24 * 60 * 60 * 1000;
const SEEN_EVERY_MS = 5 * 60 * 1000;

interface SourceSession {
  nonce: string;
  revealed: boolean;
}

interface JoinSession {
  nonce: string;
  revealed: boolean;
  source?: LinkView['source'];
}

export class SelfEngine {
  private readonly sealer: Sealer;
  /** Nonces live only in memory: an app closed half way through a link starts again with a new code. */
  private readonly sourcing = new Map<string, SourceSession>();
  private readonly joining = new Map<string, JoinSession>();

  /** The data version this install's copy is at (a test stands in a newer one). */
  protected readonly schema: number = LATEST_VERSION;

  constructor(
    private readonly database: Database,
    private readonly transport: SelfTransport,
    private readonly device: DeviceKeys,
    private readonly info: SelfDeviceInfo,
    private readonly now: () => number = Date.now,
  ) {
    this.sealer = new Sealer(database, device);
  }

  get deviceId(): string {
    return this.device.deviceId;
  }

  async group(): Promise<SelfGroup | null> {
    const [row] = await this.database.db.values<[string, number, number, string]>(sql`SELECT relay_book_id, epoch, cursor, state FROM self_group WHERE id = 1`);
    return row ? { relayBookId: row[0], epoch: Number(row[1]), cursor: Number(row[2]), state: row[3] as SelfGroup['state'] } : null;
  }

  /** The device that keeps workspaces shared with other people in step (§3.4), or null with no group. */
  async seat(): Promise<string | null> {
    const [row] = await this.database.db.values<[string]>(sql`SELECT value FROM settings WHERE key = ${SEAT_KEY}`);
    return row?.[0] ?? null;
  }

  async devices(): Promise<SelfDeviceRow[]> {
    const rows = await this.database.db.values<[string, string, string, string | null, string, string | null, string | null]>(
      sql`SELECT device_id, name, kind, app_version, added_at, last_synced_at, removed_at FROM self_devices ORDER BY added_at, device_id`,
    );
    return rows.map(([deviceId, name, kind, appVersion, addedAt, lastSyncedAt, removedAt]) => ({
      deviceId, name, kind: kind as DeviceKind, appVersion, addedAt, lastSyncedAt, removedAt, thisDevice: deviceId === this.deviceId,
    }));
  }

  /** This device's own row of the Devices list, written by itself (and so sent to the others). */
  async writeOwnRow(lastSyncedAt: string | null): Promise<void> {
    const iso = new Date(this.now()).toISOString();
    await this.database.db.run(sql`
      INSERT INTO self_devices (device_id, name, kind, sign_jwk, agree_jwk, app_version, added_at, last_synced_at)
      VALUES (${this.deviceId}, ${this.info.name}, ${this.info.kind}, ${JSON.stringify(this.device.public.signJwk)}, ${JSON.stringify(this.device.public.agreeJwk)},
              ${this.info.appVersion}, ${iso}, ${lastSyncedAt})
      ON CONFLICT (device_id) DO UPDATE SET name = excluded.name, kind = excluded.kind, app_version = excluded.app_version,
        last_synced_at = COALESCE(excluded.last_synced_at, self_devices.last_synced_at)`);
  }

  /** The group, made on the first link: its relay book, epoch 1's key, this device's row, capture on. */
  private async ensureGroup(): Promise<SelfGroup> {
    const current = await this.group();
    if (current?.state === 'unlinked') throw new SelfError('UNLINKED', 'Unlinked from this data');
    if (current) return current;
    const { bookId: relayBookId } = await this.transport.createSelfBook(this.device.public);
    const key = randomBytes(32);
    await this.database.transaction(async (tx) => {
      await this.sealer.storeEpochKeyTx(tx, selfBookId(relayBookId), 1, key);
      await tx.run(sql`INSERT INTO self_group (id, device_id, relay_book_id, epoch, cursor, state, joined_at) VALUES (1, ${this.deviceId}, ${relayBookId}, 1, 0, 'active', ${new Date(this.now()).toISOString()})`);
      // The device that made the group keeps the workspaces shared with other people in step (§3.4): the seat.
      await tx.run(sql`INSERT OR IGNORE INTO settings (key, value) VALUES (${SEAT_KEY}, ${this.deviceId})`);
    });
    await installSelfCapture(this.database);
    await this.writeOwnRow(null);
    return (await this.group())!;
  }

  /* ------------------------------------------------------------------------------------------- the source */

  /** Account › Devices › Link another device: a 6-digit code (and the square code) for the new device. */
  async startLinking(): Promise<{ sessionId: string; code: string; qr: string; expiresAt: string }> {
    await this.ensureGroup();
    const view = await this.transport.startLink(this.device.public);
    this.sourcing.set(view.sessionId, { nonce: newNonce(), revealed: false });
    return { sessionId: view.sessionId, code: view.code!, qr: linkQrText(view.code!), expiresAt: view.expiresAt };
  }

  /** Where the source's side of a link stands; it reveals its nonce as soon as the new device has committed. */
  async checkLinking(sessionId: string): Promise<SourceStage> {
    const mine = this.sourcing.get(sessionId);
    let view = await this.transport.readLink(sessionId);
    if (!mine) return { stage: 'ended', why: 'expired' };
    if (view.status === 'expired' || view.status === 'burned' || view.status === 'declined') return { stage: 'ended', why: view.status };
    if (view.status === 'allowed') return { stage: 'allowed' };
    if (view.status === 'waiting') return { stage: 'waiting', code: view.code!, qr: linkQrText(view.code!), expiresAt: view.expiresAt };
    if (!mine.revealed) {
      view = await this.transport.revealLink(sessionId, mine.nonce);
      mine.revealed = true;
    }
    if (!view.joinerNonce || !view.joiner || !view.commit) return { stage: 'waiting', code: '', qr: '', expiresAt: view.expiresAt };
    if ((await commitOf(view.joinerNonce)) !== view.commit) {
      await this.transport.declineLink(sessionId);
      return { stage: 'ended', why: 'mismatch' };
    }
    const digits = await checkDigits({ source: this.device.public, joiner: view.joiner, sourceNonce: mine.nonce, joinerNonce: view.joinerNonce });
    let deviceName = 'A new device';
    if (view.joinerName) {
      try {
        deviceName = fromUtf8(await openSealedKey(this.device.agree.privateKey, `link:${sessionId}`, view.joinerName)).slice(0, 60) || deviceName;
      } catch {
        // A name that does not open is shown as no name: the digits are what the owner checks.
      }
    }
    return { stage: 'confirm', digits, deviceName };
  }

  /**
   * Allow, after the owner saw the same digits on both screens: an invite to the group's book, its keys sealed with a
   * fresh secret, and that secret handed to the new device sealed for its own key.
   */
  async allowLinking(sessionId: string, onProgress?: (done: number, total: number) => void): Promise<void> {
    const stage = await this.checkLinking(sessionId);
    if (stage.stage !== 'confirm') throw new SelfError('MISMATCH', 'This link is not waiting to be allowed');
    const view = await this.transport.readLink(sessionId);
    // Everything sent and everything read first: the copy is then this device at `startSeq`, and the new device reads
    // the log from there (§4.1). What is written from now on goes out after it, and the relay keeps it for the new one.
    await this.sync();
    const group = (await this.group())!;
    const bookId = selfBookId(group.relayBookId);
    const startSeq = group.cursor;
    const copy = await this.uploadCopy(await this.database.exportBytes(), onProgress);
    const inviteId = crypto.randomUUID();
    const secret = newInviteSecret();
    const inviteKey = await inviteKeyOf(secret, inviteId);
    const epochKeys: InviteKey[] = (await this.sealer.epochKeysOf(bookId)).map(({ epoch, key }) => ({ epoch, key: bytesToBase64Url(key) }));
    if (epochKeys.length === 0) throw new SelfError('NO_KEY', "This device can't open its own linked devices' keys");
    const unsigned: Omit<InviteRecord, 'sig'> = {
      inviteId,
      keys: await sealInviteJson(inviteKey, epochKeys, inviteAad('keys', inviteId)),
      preview: await sealInviteJson(inviteKey, { self: true }, inviteAad('preview', inviteId)),
      expiresAt: new Date(this.now() + 24 * 60 * 60 * 1000).toISOString(),
      sameMember: true,
      memberId: 'self',
      startSeq,
    };
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.device.sign.privateKey, inviteSigningBytes(unsigned) as BufferSource);
    await this.transport.putInvite(group.relayBookId, { ...unsigned, sig: bytesToBase64Url(new Uint8Array(sig)) });
    const joiner = view.joiner!;
    const welcome = await sealKeyFor(
      { deviceId: joiner.deviceId, agreeJwk: joiner.agreeJwk },
      `link:${sessionId}`,
      1,
      utf8(JSON.stringify({ relayBookId: group.relayBookId, inviteId, secret: bytesToBase64Url(secret), copy, schema: this.schema, appVersion: this.info.appVersion } satisfies Welcome)),
    );
    // Signed with this device's key — the key the check digits covered — so a relay cannot hand the new device a
    // welcome of its own making and have it replace its data.
    const welcomeSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, this.device.sign.privateKey, welcomeSigningBytes(sessionId, joiner.deviceId, welcome) as BufferSource));
    await this.transport.allowLink(sessionId, { ...welcome, sig: bytesToBase64Url(welcomeSig) });
    // It gave its data: from now on it never takes another device's, even before the new device's row arrives.
    await this.database.db.run(sql`INSERT OR REPLACE INTO self_state (key, value) VALUES ('gave', '1')`);
    this.sourcing.delete(sessionId);
  }

  /** Don't allow: the digits did not match, or the owner changed their mind. The code is finished. */
  async declineLinking(sessionId: string): Promise<void> {
    await this.transport.declineLink(sessionId);
    this.sourcing.delete(sessionId);
    this.joining.delete(sessionId);
  }

  /* ------------------------------------------------------------------------------------------- the new device */

  /** Settings › Devices › Link…: the code typed (or scanned) on the new device. */
  async joinWithCode(text: string): Promise<{ sessionId: string }> {
    // A device that gives its data never takes another's: one linked to others, or one showing a code right now. One
    // that showed a code nobody used (its group holds only itself) may still take one.
    const group = await this.group();
    const others = group?.state === 'active' ? (await this.devices()).filter((d) => !d.thisDevice && d.removedAt === null) : [];
    // Unlinked from a group, a device may be linked again — its data replaced, after its backup, as any other's.
    const gave = group?.state !== 'unlinked' && (await this.database.db.values(sql`SELECT 1 FROM self_state WHERE key = 'gave'`)).length > 0;
    if (others.length > 0 || gave || this.sourcing.size > 0) throw new SelfError('ALREADY_LINKED', 'This device is already linked to other devices');
    const code = parseLinkCode(text);
    if (!code) throw new SelfError('BAD_CODE', 'That is not a 6-digit code');
    const nonce = newNonce();
    const view = await this.transport.claimLink(code, this.device.public, await commitOf(nonce));
    this.joining.set(view.sessionId, { nonce, revealed: false, source: view.source });
    return { sessionId: view.sessionId };
  }

  /** Where the new device's side stands; once allowed, it joins the group's book with the keys it was handed. */
  async checkJoining(sessionId: string): Promise<JoinStage> {
    const mine = this.joining.get(sessionId);
    let view = await this.transport.readLink(sessionId);
    if (!mine) return { stage: 'ended', why: 'expired' };
    if (view.status === 'expired' || view.status === 'burned' || view.status === 'declined') return { stage: 'ended', why: view.status };
    if (view.status === 'allowed' && view.welcome) return { stage: 'allowed' };
    if (!view.sourceNonce) return { stage: 'waiting' };
    if (!mine.revealed) {
      const name = await sealKeyFor({ deviceId: view.source.deviceId, agreeJwk: view.source.agreeJwk }, `link:${sessionId}`, 0, utf8(this.info.name));
      view = await this.transport.revealLink(sessionId, mine.nonce, name);
      mine.revealed = true;
    }
    return { stage: 'confirm', digits: await checkDigits({ source: view.source, joiner: this.device.public, sourceNonce: view.sourceNonce!, joinerNonce: mine.nonce }) };
  }

  /**
   * After Allow, on the new device: joins the group's book with the keys it was handed, and answers what the app needs
   * to replace this device's data — the copy to download, where the log is read from, and the group's keys sealed for
   * this device to keep at rest (`completeLinkedCopy` writes them into the copy once it is this device's data). This
   * device's own data is not touched here.
   */
  async acceptLink(sessionId: string): Promise<JoinPlan> {
    const view = await this.transport.readLink(sessionId);
    if (view.status !== 'allowed' || !view.welcome) throw new SelfError('MISMATCH', 'This link has not been allowed');
    // The welcome is the source's, signed by the very key the check digits on both screens were made from.
    const signature = (view.welcome as SealedFor & { sig?: string }).sig;
    if (!signature || !(await verifySignature(view.source.signJwk, welcomeSigningBytes(sessionId, this.deviceId, view.welcome), signature))) {
      throw new SelfError('MISMATCH', 'The other device did not send this. Nothing here was changed.');
    }
    const opened = JSON.parse(fromUtf8(await openSealedKey(this.device.agree.privateKey, `link:${sessionId}`, view.welcome))) as Welcome;
    // A copy from a newer version of the app would not open here: refused before anything is claimed or replaced.
    if (typeof opened.schema !== 'number' || opened.schema > this.schema) {
      throw new SelfError('NEWER_SOURCE', `The other device has a newer version of cicis${opened.appVersion ? ` (${opened.appVersion})` : ''}. Update cicis on this device first.`);
    }
    const claim = await this.transport.claimInvite(opened.inviteId, this.device.public);
    const keys = await openInviteJson<InviteKey[]>(await inviteKeyOf(base64UrlToBytes(opened.secret), opened.inviteId), claim.keys, inviteAad('keys', opened.inviteId));
    const bookId = selfBookId(opened.relayBookId);
    const sealed: { epoch: number; sealedJson: string }[] = [];
    for (const { epoch, key } of keys) {
      const atRest = await sealKeyFor({ deviceId: this.deviceId, agreeJwk: this.device.public.agreeJwk }, bookId, epoch, base64UrlToBytes(key), AT_REST_INFO);
      sealed.push({ epoch, sealedJson: JSON.stringify(atRest) });
    }
    this.joining.delete(sessionId);
    return { deviceId: this.deviceId, relayBookId: opened.relayBookId, epoch: claim.epoch, startSeq: claim.seq ?? 0, keys: sealed, copy: opened.copy };
  }

  /** The copy of a plan, from the relay; it is the new device's to fetch before it is a device of any group here. */
  downloadPlanCopy(plan: JoinPlan, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
    return this.downloadCopy(plan.copy, onProgress, plan.relayBookId);
  }

  /* ------------------------------------------------------------------------------------------- syncing */

  /** One round: send what waits, pull and apply the others', ack. A hold stops the pull at that entry; nothing is skipped. */
  async sync(): Promise<SelfSyncResult> {
    const group = await this.group();
    if (!group) throw new SelfError('NOT_LINKED', 'This device is not linked to other devices');
    if (group.state === 'unlinked') return { sent: 0, applied: 0, unlinked: true };
    try {
      const last = (await this.devices()).find((d) => d.thisDevice)?.lastSyncedAt;
      if (!last || this.now() - Date.parse(last) > SEEN_EVERY_MS) await this.writeOwnRow(new Date(this.now()).toISOString());
      await collectSelfChanges(this.database, this.deviceId);
      const pulled = await this.pull();
      if (pulled.unlinked || pulled.held) return { sent: 0, ...pulled };
      const sent = await this.send();
      const again = await this.pull();
      return { sent, applied: pulled.applied + again.applied, ...(again.held ? { held: again.held } : {}), ...(again.unlinked ? { unlinked: true as const } : {}) };
    } catch (error) {
      if (removedFromBook(error)) {
        await this.markUnlinked();
        return { sent: 0, applied: 0, unlinked: true };
      }
      throw error;
    }
  }

  /**
   * Unlinked by another of the owner's devices: this device stops capturing for the group (nothing it writes is sent,
   * and nothing waits to be), and is no longer kept from household sharing — its data is its own again.
   */
  private async markUnlinked(): Promise<void> {
    await this.database.db.run(sql`UPDATE self_group SET state = 'unlinked' WHERE id = 1`);
    await removeSelfCapture(this.database);
    await this.database.db.run(sql`DELETE FROM self_pending`);
    await this.database.db.run(sql`DELETE FROM self_outbox`);
  }

  /**
   * A join that will not finish (the replace failed or was called off, or the copy never arrived): this device takes
   * itself off the group's relay book, so it neither holds back the log's pruning nor fills a place.
   */
  async abandonJoin(relayBookId: string): Promise<void> {
    await this.transport.removeDevice(relayBookId, this.deviceId).catch(() => undefined);
  }

  private async send(): Promise<number> {
    let sent = 0;
    for (const { id, changeSet } of await selfOutbox(this.database)) {
      for (let attempt = 0; ; attempt += 1) {
        const group = (await this.group())!;
        const key = await this.sealer.epochKey(selfBookId(group.relayBookId), group.epoch);
        if (!key) throw new SelfError('NO_KEY', "This device can't open its linked devices' keys");
        const entry = await sealChangeSet(this.device, key, selfBookId(group.relayBookId), group.epoch, changeSet as unknown as ChangeSet);
        try {
          await this.transport.append(group.relayBookId, entry);
          break;
        } catch (error) {
          // Sealed under an epoch the book rotated past: pull the rotation in, seal again.
          if (!(error instanceof SyncTransportError && error.status === 409 && attempt === 0)) throw error;
          await this.pull();
        }
      }
      await dropFromSelfOutbox(this.database, id);
      sent += 1;
    }
    return sent;
  }

  private async pull(): Promise<{ applied: number; held?: SelfApplyResult & { status: 'held' }; unlinked?: true }> {
    let applied = 0;
    for (;;) {
      const group = (await this.group())!;
      const bookId = selfBookId(group.relayBookId);
      const { entries, latest } = await this.transport.pull(group.relayBookId, group.cursor);
      for (const entry of entries) {
        if (!(await this.trusted(bookId, entry))) throw new SelfError('MISMATCH', `An entry in this device's linked log does not verify (seq ${entry.seq})`);
        if (entry.deviceId !== this.deviceId) {
          if (entry.kind === 'change') {
            const key = await this.sealer.epochKey(bookId, entry.epoch);
            if (!key) throw new SelfError('NO_KEY', `No key here for epoch ${entry.epoch} of this device's linked log`);
            const changeSet = (await openChangeSet(key, bookId, entry as ChangeLogEntry)) as unknown as SelfChangeSet;
            const result = await applySelfChangeSet(this.database, changeSet, this.deviceId);
            if (result.status === 'held') return { applied, held: result };
            applied += 1;
          } else if (entry.kind === 'removal' && entry.target === this.deviceId) {
            await this.markUnlinked();
            return { applied, unlinked: true };
          } else if (entry.kind === 'rotation') {
            const mine = entry.sealed.find((sealed) => sealed.deviceId === this.deviceId);
            if (mine) {
              const key = await openSealedKey(this.device.agree.privateKey, bookId, mine);
              await this.database.transaction((tx) => this.sealer.storeEpochKeyTx(tx, bookId, entry.epoch, key));
            }
          }
        }
        await this.database.db.run(sql`UPDATE self_group SET cursor = ${entry.seq}, epoch = MAX(epoch, ${entry.kind === 'rotation' ? entry.epoch : 0}) WHERE id = 1`);
      }
      const now = (await this.group())!;
      if (now.cursor > group.cursor || entries.length === 0) await this.transport.ack(now.relayBookId, now.cursor).catch(() => undefined);
      if (entries.length === 0 || now.cursor >= latest) return { applied };
    }
  }

  /** An entry's author key is the one the relay pinned for it, derives to its id, and signed it. */
  private async trusted(bookId: string, entry: LogEntry & { signJwk: JsonWebKey }): Promise<boolean> {
    if ((await deviceIdOf({ signJwk: entry.signJwk }).catch(() => null)) !== entry.deviceId) return false;
    return verifyEntry(entry.signJwk, bookId, entry);
  }

  /* ------------------------------------------------------------------------------------------- unlinking */

  /**
   * Unlink a lost or sold device, from any other: a signed removal, the relay drops it, and a new epoch is sealed for
   * every device still linked — so it reads nothing written from now on. Its own data stays where it is.
   */
  async unlink(target: string): Promise<void> {
    const group = await this.group();
    if (!group || group.state !== 'active') throw new SelfError('NOT_LINKED', 'This device is not linked to other devices');
    if (target === this.deviceId) throw new SelfError('LAST_DEVICE', 'Unlink this device from another one');
    await this.sync();
    const bookId = selfBookId(group.relayBookId);
    const tick = () => this.database.transaction((tx) => localTick(tx, this.deviceId, this.now()));
    const current = (await this.group())!;
    const removal = await signEntry(this.device, bookId, { kind: 'removal' as const, deviceId: this.deviceId, epoch: current.epoch, hlc: await tick(), target });
    await this.transport.append(group.relayBookId, removal);
    await this.transport.removeDevice(group.relayBookId, target);
    const rest = (await this.devices()).filter((d) => d.removedAt === null && d.deviceId !== target);
    const next = current.epoch + 1;
    const key = randomBytes(32);
    const sealed: SealedFor[] = [];
    for (const device of rest) {
      const [row] = await this.database.db.values<[string]>(sql`SELECT agree_jwk FROM self_devices WHERE device_id = ${device.deviceId}`);
      sealed.push(await sealKeyFor({ deviceId: device.deviceId, agreeJwk: JSON.parse(row![0]) as JsonWebKey }, bookId, next, key));
    }
    const rotation = await signEntry(this.device, bookId, { kind: 'rotation' as const, deviceId: this.deviceId, epoch: next, hlc: await tick(), sealed });
    await this.transport.append(group.relayBookId, rotation);
    await this.database.transaction(async (tx) => {
      await this.sealer.storeEpochKeyTx(tx, bookId, next, key);
      await tx.run(sql`UPDATE self_group SET epoch = ${next} WHERE id = 1`);
      await tx.run(sql`UPDATE self_devices SET removed_at = ${new Date(this.now()).toISOString()} WHERE device_id = ${target}`);
    });
    await this.sync();
  }

  /* ------------------------------------------------------------------------------------------- the copy */

  /** Bytes (a copy of this device's data) sealed under a one-off key, as blobs of at most 700 KB, kept 24 hours. */
  async uploadCopy(bytes: Uint8Array, onProgress?: (done: number, total: number) => void, ttlMs: number = COPY_TTL_MS): Promise<CopyManifest> {
    const group = await this.group();
    if (!group || group.state !== 'active') throw new SelfError('NOT_LINKED', 'This device is not linked to other devices');
    const key = randomBytes(32);
    const room = MAX_BLOB_BYTES - 12 - 16; // iv and tag
    const hashes: string[] = [];
    const expiresAt = new Date(this.now() + ttlMs).toISOString();
    for (let at = 0, part = 0; at < bytes.length || part === 0; at += room, part += 1) {
      const iv = randomBytes(12);
      const ct = await aesGcmEncrypt(key, iv, bytes.subarray(at, at + room), utf8(`copy:${part}`));
      const blob = new Uint8Array(12 + ct.length);
      blob.set(iv, 0);
      blob.set(ct, 12);
      const hash = await sha256Hex(blob);
      await this.transport.putBlob(group.relayBookId, hash, bytesToBase64Url(blob), expiresAt);
      hashes.push(hash);
      onProgress?.(Math.min(at + room, bytes.length), bytes.length);
    }
    return { hashes, key: bytesToBase64Url(key), bytes: bytes.length, sha256: await sha256Hex(bytes) };
  }

  /** The copy back, each blob checked against its hash, the whole against the sha-256 it was sent with. */
  async downloadCopy(manifest: CopyManifest, onProgress?: (done: number, total: number) => void, relayBookId?: string): Promise<Uint8Array> {
    const group = relayBookId ? { relayBookId } : await this.group();
    if (!group) throw new SelfError('NOT_LINKED', 'This device is not linked to other devices');
    const key = base64UrlToBytes(manifest.key);
    const out = new Uint8Array(manifest.bytes);
    let at = 0;
    for (const [part, hash] of manifest.hashes.entries()) {
      const blob = base64UrlToBytes(await this.transport.getBlob(group.relayBookId, hash));
      if ((await sha256Hex(blob)) !== hash) throw new SelfError('MISMATCH', 'A part of the copy was altered on the way');
      const plain = await aesGcmDecrypt(key, blob.subarray(0, 12), blob.subarray(12), utf8(`copy:${part}`));
      out.set(plain, at);
      at += plain.length;
      onProgress?.(part + 1, manifest.hashes.length);
    }
    if (at !== manifest.bytes || (await sha256Hex(out)) !== manifest.sha256) throw new SelfError('MISMATCH', 'The copy did not arrive whole');
    return out;
  }

  /** Once the new device has the copy: the blobs go from the relay. */
  async deleteCopy(manifest: CopyManifest, relayBookId?: string): Promise<void> {
    const group = relayBookId ? { relayBookId } : await this.group();
    if (!group) return;
    for (const hash of manifest.hashes) await this.transport.deleteBlob(group.relayBookId, hash).catch(() => undefined);
  }
}
