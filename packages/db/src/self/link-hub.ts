import type { DevicePublic, Sealed, SealedFor } from '../sync/types';

/*
 * Link my devices (spec §3.5): the relay's half of "Link another device" — a meeting place, never a secret keeper.
 *
 * The device that holds the data (the source) opens a session and is given a 6-digit code, good for 10 minutes. The new
 * device types it (or scans it) and claims the session with its public keys and a commitment to a random nonce. Then:
 * the source reveals its nonce, the new device reveals its own, and both screens show the same 4 check digits worked out
 * from both devices' keys and both nonces. Because each side is committed before it sees what decides the digits, a
 * relay that swaps keys can match them only by luck (1 in 10,000). The owner taps Allow on the source only if the
 * digits match; the source then leaves, sealed for the new device's key, what it needs to join.
 *
 * Six digits are a meeting point the relay knows, not a secret it cannot guess — the check digits are what make it safe.
 * They are also few: so every wrong code tried counts against every session open at that moment, and a session that
 * has seen five is burned (the source shows a new code). One device may try five wrong codes in ten minutes.
 *
 * One implementation for both relays: `MemoryTransport` keeps the store in a map, the Worker in a Durable Object's
 * storage. A refusal is a `LinkRefusal` with the HTTP status either relay answers with.
 */

export const LINK_TTL_MS = 10 * 60 * 1000;
export const LINK_MAX_WRONG = 5;
const CODE_DIGITS = 6;

export class LinkRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'LinkRefusal';
  }
}

export interface LinkStore {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<unknown>;
}

export type LinkStatus = 'waiting' | 'claimed' | 'allowed' | 'declined' | 'burned' | 'expired';

interface Session {
  sessionId: string;
  code: string;
  expiresAt: number;
  sourceId: string;
  source: DevicePublic;
  wrong: number;
  status: 'waiting' | 'claimed' | 'allowed' | 'declined' | 'burned';
  joinerId?: string;
  joiner?: DevicePublic;
  /** sha256 hex of the new device's nonce, sent with its claim. */
  commit?: string;
  sourceNonce?: string;
  joinerNonce?: string;
  /** The new device's name, sealed for the source's key (the relay never reads a name). */
  joinerName?: SealedFor;
  /** What the source leaves for the new device on Allow, sealed for the new device's key. */
  welcome?: SealedFor & { payload?: Sealed; sig?: string };
}

/** What either device of a session sees of it. */
export interface LinkView {
  sessionId: string;
  status: LinkStatus;
  expiresAt: string;
  /** Only to the source, and only while the code still works. */
  code?: string;
  source: DevicePublic & { deviceId: string };
  joiner?: DevicePublic & { deviceId: string };
  commit?: string;
  sourceNonce?: string;
  joinerNonce?: string;
  joinerName?: SealedFor;
  welcome?: SealedFor & { payload?: Sealed; sig?: string };
}

const sessionKey = (id: string) => `session:${id}`;
const codeKey = (code: string) => `code:${code}`;
const triesKey = (deviceId: string) => `tries:${deviceId}`;
/** Every session not yet forgotten: an ended one stays an hour past its expiry, so the new device can still read it. */
const SESSIONS = 'sessions';
const KEEP_MS = 60 * 60 * 1000;

export class LinkHub {
  constructor(
    private readonly store: LinkStore,
    private readonly now: () => number = Date.now,
    private readonly random: (bytes: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
  ) {}

  private newCode(): string {
    const bytes = this.random(4);
    const n = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
    return String(n % 10 ** CODE_DIGITS).padStart(CODE_DIGITS, '0');
  }

  private newId(): string {
    return Array.from(this.random(16), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  private async live(): Promise<string[]> {
    return (await this.store.get<string[]>(SESSIONS)) ?? [];
  }

  private async session(id: string): Promise<Session> {
    const found = await this.store.get<Session>(sessionKey(id));
    if (!found) throw new LinkRefusal(404, 'no such link');
    return found;
  }

  private statusOf(session: Session): LinkStatus {
    if (session.status === 'waiting' || session.status === 'claimed') return session.expiresAt <= this.now() ? 'expired' : session.status;
    return session.status;
  }

  private view(session: Session, actor: string): LinkView {
    const status = this.statusOf(session);
    return {
      sessionId: session.sessionId,
      status,
      expiresAt: new Date(session.expiresAt).toISOString(),
      ...(actor === session.sourceId && status === 'waiting' ? { code: session.code } : {}),
      source: { ...session.source, deviceId: session.sourceId },
      ...(session.joiner ? { joiner: { ...session.joiner, deviceId: session.joinerId! } } : {}),
      ...(session.commit ? { commit: session.commit } : {}),
      ...(session.sourceNonce ? { sourceNonce: session.sourceNonce } : {}),
      ...(session.joinerNonce ? { joinerNonce: session.joinerNonce } : {}),
      ...(session.joinerName ? { joinerName: session.joinerName } : {}),
      ...(session.welcome && actor === session.joinerId ? { welcome: session.welcome } : {}),
    };
  }

  /** A party of the session — its source, or the device that claimed it. Anyone else is told nothing (404). */
  private async party(actor: string, sessionId: string): Promise<Session> {
    const session = await this.session(sessionId);
    if (actor !== session.sourceId && actor !== session.joinerId) throw new LinkRefusal(404, 'no such link');
    return session;
  }

  /** The source opens a session: a fresh 6-digit code no other open session holds. */
  async start(actor: string, source: DevicePublic): Promise<LinkView> {
    const kept: string[] = [];
    for (const id of await this.live()) {
      const s = await this.store.get<Session>(sessionKey(id));
      if (!s) continue;
      if (s.expiresAt + KEEP_MS > this.now()) {
        kept.push(id);
        continue;
      }
      await this.store.delete(sessionKey(id));
      if ((await this.store.get<string>(codeKey(s.code))) === id) await this.store.delete(codeKey(s.code));
    }
    let code = this.newCode();
    for (let tries = 0; (await this.store.get<string>(codeKey(code))) !== undefined; tries += 1) {
      if (tries > 20) throw new LinkRefusal(503, 'no code free; try again');
      code = this.newCode();
    }
    const session: Session = { sessionId: this.newId(), code, expiresAt: this.now() + LINK_TTL_MS, sourceId: actor, source: { signJwk: source.signJwk, agreeJwk: source.agreeJwk }, wrong: 0, status: 'waiting' };
    await this.store.put({ [sessionKey(session.sessionId)]: session, [codeKey(code)]: session.sessionId, [SESSIONS]: [...kept, session.sessionId] });
    return this.view(session, actor);
  }

  /** The new device types the code: it claims the session with its keys and its commitment, once. */
  async claim(actor: string, code: string, joiner: DevicePublic, commit: string): Promise<LinkView> {
    const tries = (await this.store.get<{ count: number; since: number }>(triesKey(actor))) ?? { count: 0, since: this.now() };
    const window = this.now() - tries.since < LINK_TTL_MS ? tries : { count: 0, since: this.now() };
    if (window.count >= LINK_MAX_WRONG) throw new LinkRefusal(429, 'too many wrong codes; wait a few minutes');
    if (!/^[0-9a-f]{64}$/.test(commit)) throw new LinkRefusal(400, 'expected a commitment');
    const id = /^\d{6}$/.test(code) ? await this.store.get<string>(codeKey(code)) : undefined;
    const session = id ? await this.store.get<Session>(sessionKey(id)) : undefined;
    if (!session || this.statusOf(session) !== 'waiting' || actor === session.sourceId) {
      await this.wrongCode(actor, window);
      if (session && this.statusOf(session) === 'expired') throw new LinkRefusal(410, 'this code has expired');
      throw new LinkRefusal(404, 'no such code');
    }
    const claimed: Session = { ...session, status: 'claimed', joinerId: actor, joiner: { signJwk: joiner.signJwk, agreeJwk: joiner.agreeJwk }, commit };
    await this.store.put({ [sessionKey(session.sessionId)]: claimed });
    await this.store.delete(codeKey(session.code)); // claimed once: the code works for nobody else (and may be handed out again)
    return this.view(claimed, actor);
  }

  /** A wrong code counts against its device, and against every session open now; five burn a session. */
  private async wrongCode(actor: string, window: { count: number; since: number }): Promise<void> {
    await this.store.put({ [triesKey(actor)]: { count: window.count + 1, since: window.since } });
    for (const id of await this.live()) {
      const s = await this.store.get<Session>(sessionKey(id));
      if (!s || this.statusOf(s) !== 'waiting') continue;
      const wrong = s.wrong + 1;
      await this.store.put({ [sessionKey(id)]: { ...s, wrong, status: wrong >= LINK_MAX_WRONG ? 'burned' : s.status } });
      if (wrong >= LINK_MAX_WRONG && (await this.store.get<string>(codeKey(s.code))) === id) await this.store.delete(codeKey(s.code));
    }
  }

  /** The signing key a party's request to the session is checked against (the relay knows no other for them). */
  async partyKey(actor: string, sessionId: string): Promise<JsonWebKey> {
    const session = await this.party(actor, sessionId);
    return actor === session.sourceId ? session.source.signJwk : session.joiner!.signJwk;
  }

  async read(actor: string, sessionId: string): Promise<LinkView> {
    return this.view(await this.party(actor, sessionId), actor);
  }

  /**
   * A nonce, revealed: the source's only once the new device has committed to its own, the new device's only once the
   * source's is there. Each once. The new device sends its name with it, sealed for the source.
   */
  async reveal(actor: string, sessionId: string, nonce: string, joinerName?: SealedFor): Promise<LinkView> {
    const session = await this.party(actor, sessionId);
    if (this.statusOf(session) !== 'claimed') throw new LinkRefusal(409, 'this link is not waiting for that');
    if (!/^[A-Za-z0-9_-]{43}$/.test(nonce)) throw new LinkRefusal(400, 'expected a nonce');
    let next: Session;
    if (actor === session.sourceId) {
      if (session.sourceNonce) throw new LinkRefusal(409, 'already revealed');
      next = { ...session, sourceNonce: nonce };
    } else {
      if (!session.sourceNonce) throw new LinkRefusal(409, 'the other device goes first');
      if (session.joinerNonce) throw new LinkRefusal(409, 'already revealed');
      next = { ...session, joinerNonce: nonce, ...(joinerName ? { joinerName } : {}) };
    }
    await this.store.put({ [sessionKey(sessionId)]: next });
    return this.view(next, actor);
  }

  /** The owner tapped Allow on the source: what the new device needs, sealed for it. */
  async allow(actor: string, sessionId: string, welcome: SealedFor & { payload?: Sealed; sig?: string }): Promise<void> {
    const session = await this.party(actor, sessionId);
    if (actor !== session.sourceId) throw new LinkRefusal(403, 'only the device showing the code allows');
    if (this.statusOf(session) !== 'claimed' || !session.joinerNonce) throw new LinkRefusal(409, 'nothing to allow yet');
    await this.store.put({ [sessionKey(sessionId)]: { ...session, status: 'allowed', welcome } });
  }

  /** Don't allow (or the digits did not match): the session ends, its code with it. Either party may end it. */
  async decline(actor: string, sessionId: string): Promise<void> {
    const session = await this.party(actor, sessionId);
    if (session.status === 'allowed') throw new LinkRefusal(409, 'already allowed');
    await this.store.put({ [sessionKey(sessionId)]: { ...session, status: 'declined' } });
    if ((await this.store.get<string>(codeKey(session.code))) === sessionId) await this.store.delete(codeKey(session.code));
  }
}
