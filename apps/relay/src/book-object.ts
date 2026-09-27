import { DurableObject } from 'cloudflare:workers';
import { verifySignature } from '../../../packages/db/src/sync/relay-signing';
import type { DevicePublic, InviteRecord, LogEntry } from '../../../packages/db/src/sync/types';
import { Book, RelayError } from './book';
import type { Env } from './env';

/*
 * One Durable Object per book (spec §9). The Worker checks the request's shape and timestamp, then calls in here;
 * this object checks the signature against the device key it holds (§9.1) and runs the rule in `Book`. Calls run
 * strictly one at a time: a signature check awaits WebCrypto, which lets another request in, so a lock keeps two
 * appends from reading the same `seq`.
 */

export interface Result {
  status: number;
  body?: unknown;
}

/** What the Worker hands over for a member's request: who it claims to be and what it signed. */
export interface SignedCall {
  deviceId: string;
  signingBytes: Uint8Array;
  signature: string;
}

export type MemberOp =
  | { type: 'append'; entry: LogEntry }
  | { type: 'pull'; since: number }
  | { type: 'putInvite'; invite: InviteRecord }
  | { type: 'removeDevice'; target: string }
  | { type: 'setOwners'; deviceIds: string[] }
  | { type: 'deleteBook' };

export class BookObject extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();

  private readonly book = new Book(this.ctx.storage, (inviteId, bookId) =>
    this.env.INVITES.get(this.env.INVITES.idFromName(inviteId)).attach(bookId),
  );

  async create(bookId: string, device: DevicePublic, deviceId: string): Promise<Result> {
    return this.serial(async () => ({ status: 201, body: await this.book.create(bookId, device, deviceId) }));
  }

  async preview(inviteId: string): Promise<Result> {
    return this.serial(async () => ({ status: 200, body: await this.book.previewInvite(inviteId) }));
  }

  async claim(inviteId: string, device: DevicePublic, deviceId: string): Promise<Result> {
    return this.serial(async () => ({ status: 200, body: await this.book.claimInvite(inviteId, device, deviceId) }));
  }

  async member(call: SignedCall, op: MemberOp): Promise<Result> {
    return this.serial(async () => {
      const key = await this.book.memberKey(call.deviceId);
      if (!(await verifySignature(key, call.signingBytes, call.signature))) throw new RelayError(401, 'bad signature');
      const actor = call.deviceId;
      switch (op.type) {
        case 'append': {
          const { seq, created } = await this.book.append(op.entry, actor);
          return { status: created ? 201 : 200, body: { seq } };
        }
        case 'pull':
          return { status: 200, body: await this.book.pull(op.since, actor) };
        case 'putInvite':
          await this.book.putInvite(op.invite, actor);
          return { status: 201 };
        case 'removeDevice':
          await this.book.removeDevice(op.target, actor);
          return { status: 204 };
        case 'setOwners':
          await this.book.setOwners(op.deviceIds, actor);
          return { status: 204 };
        case 'deleteBook':
          await this.book.deleteBook(actor);
          return { status: 204 };
      }
    });
  }

  /** Runs `work` after every call before it has finished, and turns a `RelayError` into its status. */
  private serial(work: () => Promise<Result>): Promise<Result> {
    const run = this.queue.then(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof RelayError) return { status: error.status, body: { ...error.detail, error: error.message } };
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
