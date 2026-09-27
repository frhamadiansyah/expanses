import type { BookObject } from './book-object';
import type { InviteObject } from './invite-object';

export interface Env {
  BOOKS: DurableObjectNamespace<BookObject>;
  INVITES: DurableObjectNamespace<InviteObject>;
  /** Comma-separated origins a browser may call the relay from (wrangler.toml `[vars]`). */
  ALLOWED_ORIGINS?: string;
}
