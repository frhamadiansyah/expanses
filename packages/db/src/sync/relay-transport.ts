import { bytesToBase64Url, requestSigningBytes, type RequestSigner } from './relay-signing';
import type { ClaimResult, DevicePublic, InviteRecord, LogEntry, Sealed, SequencedEntry, SyncTransport } from './types';
import { SyncTransportError } from './types';

/*
 * `SyncTransport` over HTTP to the Cloudflare relay (spec §9). Every call except `GET /invites/:id` carries the §9.1
 * headers, signed by the device's own key. A relay refusal becomes the same `SyncTransportError` `MemoryTransport`
 * throws, with the HTTP status; a relay that cannot be reached at all is status 0. A `200` on append (a duplicate
 * `(deviceId, hlc)`) is success with the original seq, exactly like `201`.
 */

/** The local relay `npm run relay` starts. The web app passes `VITE_RELAY_URL` when it is set (apps/web/src/sync). */
export const DEFAULT_RELAY_URL = 'http://localhost:8787';

export interface RelayTransportOptions {
  /** Where the relay lives; defaults to `DEFAULT_RELAY_URL`. A trailing slash is ignored. */
  baseUrl?: string;
  signer: RequestSigner;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** The clock stamped into `X-Timestamp`; defaults to `Date.now`. */
  now?: () => number;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export class RelayTransport implements SyncTransport {
  private readonly baseUrl: string;
  private readonly signer: RequestSigner;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(options: RelayTransportOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_RELAY_URL).replace(/\/+$/, '');
    this.signer = options.signer;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  async createBook(device: DevicePublic): Promise<{ bookId: string }> {
    return (await this.call('POST', '/books', device)) as { bookId: string };
  }

  async append(bookId: string, entry: LogEntry): Promise<{ seq: number }> {
    return (await this.call('POST', `/books/${seg(bookId)}/entries`, entry)) as { seq: number };
  }

  async pull(bookId: string, since: number): Promise<{ entries: SequencedEntry[]; latest: number }> {
    return (await this.call('GET', `/books/${seg(bookId)}/entries?since=${since}`)) as { entries: SequencedEntry[]; latest: number };
  }

  async putInvite(bookId: string, invite: InviteRecord): Promise<void> {
    await this.call('POST', `/books/${seg(bookId)}/invites`, invite);
  }

  async previewInvite(inviteId: string): Promise<{ preview: Sealed; expiresAt: string; claimed: boolean }> {
    return (await this.call('GET', `/invites/${seg(inviteId)}`, undefined, false)) as {
      preview: Sealed;
      expiresAt: string;
      claimed: boolean;
    };
  }

  async claimInvite(inviteId: string, device: DevicePublic): Promise<ClaimResult> {
    return (await this.call('POST', `/invites/${seg(inviteId)}/claim`, device)) as ClaimResult;
  }

  async removeDevice(bookId: string, deviceId: string): Promise<void> {
    await this.call('DELETE', `/books/${seg(bookId)}/devices/${seg(deviceId)}`);
  }

  async setOwners(bookId: string, deviceIds: string[]): Promise<void> {
    await this.call('PUT', `/books/${seg(bookId)}/owners`, { deviceIds });
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.call('DELETE', `/books/${seg(bookId)}`);
  }

  private async call(method: Method, path: string, body?: unknown, signed = true): Promise<unknown> {
    const bytes = body === undefined ? new Uint8Array() : new TextEncoder().encode(JSON.stringify(body));
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (signed) {
      const timestamp = String(this.now());
      const signature = await this.signer.sign(await requestSigningBytes(method, path, timestamp, bytes));
      headers['X-Device'] = this.signer.deviceId;
      headers['X-Timestamp'] = timestamp;
      headers['X-Signature'] = bytesToBase64Url(signature);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : (bytes as BodyInit),
      });
    } catch (error) {
      throw new SyncTransportError(0, `relay unreachable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const text = await response.text();
    if (!response.ok) throw new SyncTransportError(response.status, errorMessage(text, response.status), errorDetail(text));
    return text ? JSON.parse(text) : undefined;
  }
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

/** What else a refusal says: a deleted book's `410` names the device that deleted it (§8.6, §9.2). */
function errorDetail(text: string): { deletedBy?: string } {
  try {
    const parsed = JSON.parse(text) as { deletedBy?: unknown };
    return typeof parsed.deletedBy === 'string' ? { deletedBy: parsed.deletedBy } : {};
  } catch {
    return {};
  }
}

function errorMessage(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown };
    if (typeof parsed.error === 'string') return parsed.error;
  } catch {
    // Not JSON — a proxy's HTML page, say. The status still says what happened.
  }
  return `relay answered ${status}`;
}
