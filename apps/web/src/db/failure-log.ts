import type { RecoveryReason } from './open';

/**
 * What the recovery screen records each time it is shown for a failure: `expanses-safety/last-failure.json`.
 *
 * The screen says what a person can act on; this says what actually happened — SQLite's or the browser's own
 * words, the build, and what was in the slot files and the safety folder at that moment — so a failure on a
 * phone with no console can be read off a screenshot. Only the recovery screen writes it, never the path to
 * first paint, and nothing here may throw into that screen.
 */

export const FAILURE_LOG = 'last-failure.json';

/** How many failures are kept, newest first. */
const KEEP = 5;

/** Where the SAH pool's own header ends and the database's first byte would be, in every slot file. */
const DATA_OFFSET = 4096;
const MAGIC = 'SQLite format 3\0';

export interface SlotSurvey {
  /** Relative to the pool folder. */
  path: string;
  bytes: number;
  /** Whether "SQLite format 3\0" sits right after the pool header. */
  sqlite: boolean;
}

export interface FailureEntry {
  at: string;
  kind: RecoveryReason['kind'];
  detail: string;
  midSession: boolean;
  /** The app's version and build, when the shell would say. */
  build: string | null;
  /** The newest update this build knows. */
  latestVersion: number;
  slots: SlotSurvey[];
  copies: { file: string; bytes: number }[];
}

export function appendEntry(previous: FailureEntry[], entry: FailureEntry, keep = KEEP): FailureEntry[] {
  return [entry, ...previous].slice(0, keep);
}

const isEntry = (value: unknown): value is FailureEntry => {
  const e = value as Partial<FailureEntry> | null;
  return !!e && typeof e.at === 'string' && typeof e.kind === 'string' && typeof e.detail === 'string' && Array.isArray(e.slots) && Array.isArray(e.copies);
};

export function parseFailureLog(raw: Uint8Array | null): FailureEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

interface SurveyFile {
  kind: 'file';
  name: string;
  getFile(): Promise<{ size: number; slice(from: number, to: number): { arrayBuffer(): Promise<ArrayBuffer> } }>;
}
interface SurveyFolder {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<SurveyFile | SurveyFolder>;
}

/** Every file under the pool folder, however deep: its size, and whether a database starts after the header. */
export async function surveySlots(root: { getDirectoryHandle(name: string): Promise<unknown> }, folder = '.expanses'): Promise<SlotSurvey[]> {
  const top = (await root.getDirectoryHandle(folder).catch(() => null)) as SurveyFolder | null;
  if (!top) return [];
  const found: SlotSurvey[] = [];
  const walk = async (dir: SurveyFolder, prefix: string) => {
    const entries: (SurveyFile | SurveyFolder)[] = [];
    for await (const entry of dir.values()) entries.push(entry);
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        await walk(entry, `${prefix}${entry.name}/`);
        continue;
      }
      const opened = await entry.getFile().catch(() => null);
      if (!opened) {
        found.push({ path: `${prefix}${entry.name}`, bytes: -1, sqlite: false });
        continue;
      }
      // Sixteen bytes, never the file: a slot can be tens of megabytes.
      const head = opened.size >= DATA_OFFSET + 16 ? new Uint8Array(await opened.slice(DATA_OFFSET, DATA_OFFSET + 16).arrayBuffer()) : null;
      found.push({ path: `${prefix}${entry.name}`, bytes: opened.size, sqlite: !!head && new TextDecoder().decode(head) === MAGIC });
    }
  };
  await walk(top, '');
  return found;
}

export interface FailureLogDeps {
  now?: () => Date;
  build: () => Promise<string | null>;
  slots: () => Promise<SlotSurvey[]>;
  /** Every file in the safety folder, whole or not: the broken ones are the point. */
  copies: () => Promise<{ file: string; bytes: number }[]>;
  read: () => Promise<Uint8Array | null>;
  write: (bytes: Uint8Array) => Promise<void>;
  latestVersion?: number;
}

/** Adds this failure to the log and answers with the whole log. Never throws: each part that fails is left empty. */
export async function recordFailure(reason: RecoveryReason, deps: FailureLogDeps): Promise<FailureEntry[]> {
  const quietly = async <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await work();
    } catch {
      return fallback;
    }
  };
  const entry: FailureEntry = {
    at: (deps.now?.() ?? new Date()).toISOString(),
    kind: reason.kind,
    detail: reason.detail,
    midSession: !!reason.midSession,
    build: await quietly(deps.build, null),
    latestVersion: deps.latestVersion ?? 0,
    slots: await quietly(deps.slots, []),
    copies: (await quietly(deps.copies, [] as { file: string; bytes: number }[])).map(({ file, bytes }) => ({ file, bytes })),
  };
  const log = appendEntry(parseFailureLog(await quietly(deps.read, null)), entry);
  await quietly(() => deps.write(new TextEncoder().encode(JSON.stringify(log, null, 2))), undefined);
  return log;
}

/** The log as plain text, for "Details": one block per failure, newest first. */
export function formatFailureLog(log: FailureEntry[]): string {
  return log
    .map((e) =>
      [
        `${e.at} · ${e.kind}${e.midSession ? ' · while open' : ''}`,
        `Build ${e.build ?? 'not known'} · update ${e.latestVersion}`,
        e.detail,
        `Slot files: ${e.slots.length ? e.slots.map((s) => `${s.path} ${s.bytes} bytes${s.sqlite ? ', SQLite' : ''}`).join('; ') : 'none'}`,
        `Safety copies: ${e.copies.length ? e.copies.map((c) => `${c.file} ${c.bytes} bytes`).join('; ') : 'none'}`,
      ].join('\n'),
    )
    .join('\n\n');
}
