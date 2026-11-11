import { App as Shell } from '@capacitor/app';
import { LATEST_VERSION } from '@expanses/db';
import { type FailureEntry, FAILURE_LOG, parseFailureLog, recordFailure, surveySlots } from '../../db/failure-log';
import type { RecoveryReason } from '../../db/open';
import { readSafetyFile, safetyFolderFiles, writeSafetyFile } from '../../db/snapshots';

/** The app's version and build from the native shell, or null on the web or when it will not say in time. */
export async function buildName(): Promise<string | null> {
  const info = Shell.getInfo().then((found) => `${found.version} (${found.build})`);
  const late = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
  return Promise.race([info, late]);
}

/**
 * Each failure once per page, however many times React mounts or redraws the screen that shows it. Keyed by
 * what it says rather than by object: the error boundary builds a new reason on every render.
 */
const recorded = new Map<string, Promise<FailureEntry[]>>();

/**
 * Records `reason` in `expanses-safety/last-failure.json` and answers with the log. Only ever called from
 * the recovery screen, so the slot survey never sits on the way to first paint. Never throws.
 */
export function recordOnDevice(reason: RecoveryReason): Promise<FailureEntry[]> {
  const key = `${reason.kind}\n${reason.midSession ? 1 : 0}\n${reason.detail}`;
  let pending = recorded.get(key);
  if (!pending) {
    pending = recordFailure(reason, {
      build: buildName,
      latestVersion: LATEST_VERSION,
      slots: async () => surveySlots(await navigator.storage.getDirectory()),
      copies: safetyFolderFiles,
      read: () => readSafetyFile(FAILURE_LOG),
      write: (bytes) => writeSafetyFile(FAILURE_LOG, bytes),
    }).catch(() => []);
    recorded.set(key, pending);
  }
  return pending;
}

/** The log as it stands, without adding to it: for a screen that was asked for rather than failed into. */
export async function readFailureLog(): Promise<FailureEntry[]> {
  return parseFailureLog(await readSafetyFile(FAILURE_LOG).catch(() => null));
}
