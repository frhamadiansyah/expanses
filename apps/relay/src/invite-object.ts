import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

/*
 * One per invite id, holding only the id of the book whose Durable Object keeps the invite (spec §9.3's note).
 * `GET /invites/:id` and `POST /invites/:id/claim` arrive with an invite id and nothing else; this is how the Worker
 * finds the book without scanning every book the way `MemoryTransport.findInvite` can in memory.
 */
export class InviteObject extends DurableObject<Env> {
  async bookId(): Promise<string | null> {
    return (await this.ctx.storage.get<string>('bookId')) ?? null;
  }

  /** Points this invite id at `bookId`; false when it already points at another book. */
  async attach(bookId: string): Promise<boolean> {
    const current = await this.ctx.storage.get<string>('bookId');
    if (current !== undefined) return current === bookId;
    await this.ctx.storage.put('bookId', bookId);
    return true;
  }
}
