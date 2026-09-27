/*
 * The few Workers runtime types the relay uses, declared by hand. `@cloudflare/workers-types` replaces the DOM lib
 * wholesale, and its `JsonWebKey` (with `kty` required) rejects the shared sync code in packages/db, which is typed
 * against the DOM lib the app, the tests and the Worker all share at runtime. Only what src/ touches is here.
 */

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  put<T>(entries: Record<string, T>): Promise<void>;
  list<T = unknown>(options?: { prefix?: string; start?: string; end?: string; limit?: number }): Promise<Map<string, T>>;
}

interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly storage: DurableObjectStorage;
}

/** A stub's RPC surface: every public method of the object, as a promise. */
type DurableObjectStub<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
}

interface ExportedHandler<Env = unknown> {
  fetch?(request: Request, env: Env, ctx: unknown): Response | Promise<Response>;
}

declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected readonly ctx: DurableObjectState;
    protected readonly env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
