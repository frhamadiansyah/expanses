import type { Database } from '@expanses/db';
import { Cloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Safety } from '../../../db/open';
import { ErrorBox } from '../../../ui';
import { InsetGroup, InsetRow } from '../../../ui/native';
import { hasData } from './data';
import type { CopyContents } from './envelope';
import type { CloudCopy } from './names';
import { hasICloud, ICloudBackup } from './plugin';
import { restoreContents } from './runner';
import { cloudCopies, openCopy } from './service';
import { whenShort } from './words';

/** "Start fresh" is remembered on the device, so the question is asked once, not at every open of an empty app. */
const DISMISSED_KEY = 'cicis.icloud-backup.welcome-dismissed';

/** How long the first open waits on iCloud before showing the app anyway: a slow network never holds the app back. */
const WAIT_MS = 4000;

/**
 * The newest copy in iCloud, when this is an empty app on an iPhone that has one and the owner has not already said
 * "Start fresh" — otherwise null, and the app opens as it always has.
 */
export async function welcomeCopy(database: Database): Promise<CloudCopy | null> {
  if (!hasICloud()) return null;
  try {
    if (localStorage.getItem(DISMISSED_KEY) === '1') return null;
  } catch {
    // No storage: ask; the answer cannot be remembered, but an empty app is the only place this shows anyway.
  }
  const found = (async () => {
    if (await hasData(database)) return null;
    return (await cloudCopies(ICloudBackup))?.copies[0] ?? null;
  })().catch(() => null);
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS));
  return Promise.race([found, timeout]);
}

function dismiss() {
  try {
    localStorage.setItem(DISMISSED_KEY, '1');
  } catch {
    // Remembered for this open only.
  }
}

const count = (n: number) => n.toLocaleString('id-ID');

/**
 * The first screen on a new iPhone, or after reinstalling: a copy was found in iCloud, here is what is in it, and
 * Restore or Start fresh. Starting fresh leaves the iCloud copies exactly where they are.
 */
export function ICloudWelcome({ copy, database, safety, onDone }: { copy: CloudCopy; database: Database; safety?: Safety; onDone: () => void }) {
  const [contents, setContents] = useState<CopyContents | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    openCopy(ICloudBackup, copy.name)
      .then((opened) => live && setContents(opened))
      .catch((e: unknown) => live && setError(e));
    return () => {
      live = false;
    };
  }, [copy.name]);

  async function onRestore() {
    if (!contents) return;
    setBusy(true);
    setError(null);
    try {
      await restoreContents(contents, { database, safety });
      window.location.replace('/');
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--ph-bg)] px-[16px] text-[var(--ph-ink)]" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center text-center">
        <div className="mb-[16px] grid h-[64px] w-[64px] place-items-center rounded-[16px] bg-[var(--ph-surface)] text-[var(--ph-tint)]">
          <Cloud size={30} aria-hidden />
        </div>
        <h1 className="text-[22px] leading-[28px] font-bold">Backup found in iCloud</h1>
        <p className="mt-[8px] mb-[18px] text-[15px] text-[var(--ph-ink-3)]">
          From {copy.model} · {whenShort(copy.takenAt)}
        </p>
        <div className="w-full text-left">
          <InsetGroup>
            <InsetRow title="Accounts" value={contents ? count(contents.summary.accounts) : '…'} valueTone="ink-3" chevron={false} />
            <InsetRow title="Transactions" value={contents ? count(contents.summary.transactions) : '…'} valueTone="ink-3" chevron={false} />
            <InsetRow title="Photos" value={contents ? count(contents.summary.photos) : '…'} valueTone="ink-3" chevron={false} />
          </InsetGroup>
          <ErrorBox error={error} />
        </div>
      </div>
      <div className="mx-auto w-full max-w-md">
        <button
          type="button"
          disabled={!contents || busy}
          onClick={() => void onRestore()}
          className="ph-focus w-full rounded-[14px] bg-[var(--ph-tint)] p-[14px] text-[17px] font-semibold text-white disabled:opacity-40"
        >
          {busy ? 'Restoring…' : 'Restore'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            dismiss();
            onDone();
          }}
          className="ph-focus w-full p-[14px] text-[17px] text-[var(--ph-tint)] disabled:opacity-40"
        >
          Start fresh
        </button>
      </div>
    </div>
  );
}
