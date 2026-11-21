import type { BookObject } from './book-object';
import type { InviteObject } from './invite-object';
import type { LinkObject } from './link-object';

export interface Env {
  BOOKS: DurableObjectNamespace<BookObject>;
  INVITES: DurableObjectNamespace<InviteObject>;
  /** Link my devices: the one link meeting place. */
  LINKS: DurableObjectNamespace<LinkObject>;
  /** Comma-separated origins a browser may call the relay from (wrangler.toml `[vars]`). */
  ALLOWED_ORIGINS?: string;
}
