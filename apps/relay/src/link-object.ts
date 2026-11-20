import { DurableObject } from 'cloudflare:workers';
import { LinkHub, LinkRefusal } from '../../../packages/db/src/self/link-hub';
import { verifySignature } from '../../../packages/db/src/sync/relay-signing';
import type { DevicePublic, Sealed, SealedFor } from '../../../packages/db/src/sync/types';
import type { Result, SignedCall } from './book-object';
import type { Env } from './env';

/*
 * Link my devices (spec §3.5): the one Durable Object that is the link meeting place, every session in it — links are
 * few and short, and one object makes a code's uniqueness and the wrong-code count plain. The rules are
 * `LinkHub`'s (packages/db/src/self/link-hub.ts), the very code `MemoryTransport` runs. A party's request is checked
 * here against the key the session holds for it; the Worker has already checked a new device's own key.
 */

export type LinkOp =
  | { type: 'read' }
  | { type: 'reveal'; nonce: string; joinerName?: SealedFor }
  | { type: 'allow'; welcome: SealedFor & { payload?: Sealed } }
  | { type: 'decline' };

export class LinkObject extends DurableObject<Env> {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly hub = new LinkHub({
    get: (key) => this.ctx.storage.get(key),
    put: (entries) => this.ctx.storage.put(entries),
    delete: (key) => this.ctx.storage.delete(key),
  });

  async start(deviceId: string, device: DevicePublic): Promise<Result> {
    return this.serial(async () => ({ status: 201, body: await this.hub.start(deviceId, device) }));
  }

  async claim(deviceId: string, code: string, device: DevicePublic, commit: string): Promise<Result> {
    return this.serial(async () => ({ status: 200, body: await this.hub.claim(deviceId, code, device, commit) }));
  }

  async party(call: SignedCall, sessionId: string, op: LinkOp): Promise<Result> {
    return this.serial(async () => {
      const key = await this.hub.partyKey(call.deviceId, sessionId);
      if (!(await verifySignature(key, call.signingBytes, call.signature))) throw new LinkRefusal(401, 'bad signature');
      switch (op.type) {
        case 'read':
          return { status: 200, body: await this.hub.read(call.deviceId, sessionId) };
        case 'reveal':
          return { status: 200, body: await this.hub.reveal(call.deviceId, sessionId, op.nonce, op.joinerName) };
        case 'allow':
          await this.hub.allow(call.deviceId, sessionId, op.welcome);
          return { status: 204 };
        case 'decline':
          await this.hub.decline(call.deviceId, sessionId);
          return { status: 204 };
      }
    });
  }

  private serial(work: () => Promise<Result>): Promise<Result> {
    const run = this.queue.then(async () => {
      try {
        return await work();
      } catch (error) {
        if (error instanceof LinkRefusal) return { status: error.status, body: { error: error.message } };
        throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
