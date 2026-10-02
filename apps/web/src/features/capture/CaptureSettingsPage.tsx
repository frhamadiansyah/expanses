import { type CaptureScope, getCaptureScope, setCaptureScope } from '@expanses/db';
import { useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useScanReceipt } from '../../capture/use-scan';
import { useAccounts } from '../../lib/queries';
import { Button, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, SCREEN, SegmentedControl } from '../../ui/native';
import { useCaptureSources } from '../review/queries';
import { CAPTURE_GUIDES, isShortcutLink, SCREEN_SCANNER_SHORTCUT_URL } from './guides';

/**
 * Settings → Capture: how to make capture happen, what it is allowed to keep, and what it has learned.
 *
 * The guides are data (`guides.ts`) and open in place, one at a time, because they are read with the phone in the
 * other hand — a step list behind a navigation push would be one flick too many. The one control is the scope:
 * everything, or only money going out. Below, every source the phone has recognised, with the account it files
 * into and whether it has learned a layout yet.
 */
export function CaptureSettingsPage() {
  const { database } = useApp();
  const accounts = useAccounts().data ?? [];
  const sources = useCaptureSources();
  const scan = useScanReceipt();
  const [scope, setScope] = useState<CaptureScope>('everything');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    void getCaptureScope(database)
      .then(setScope)
      .catch((e: unknown) => setError(e));
  }, [database]);

  async function chooseScope(next: CaptureScope) {
    setError(null);
    setScope(next);
    try {
      await setCaptureScope(database, next);
    } catch (e) {
      setError(e);
    }
  }

  const nameOf = (id: string | null) => accounts.find((account) => account.id === id)?.name ?? 'No account yet';

  return (
    <div className={SCREEN}>
      <LargeTitle title="Capture" back="Settings" backTo="/settings" />
      <ErrorBox error={error ?? scan.error ?? sources.error} />

      {CAPTURE_GUIDES.map((guide) => {
        const shown = open === guide.key;
        return (
          <InsetGroup
            key={guide.key}
            header={guide.title}
            footer={
              shown ? (
                <span className="block">
                  {guide.note && <span className="block pb-2">{guide.note}</span>}
                  <ol className="list-decimal space-y-1 pl-5">
                    {guide.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                </span>
              ) : (
                guide.blurb
              )
            }
          >
            <InsetRow
              title={shown ? 'Hide the steps' : 'Show the steps'}
              chevron={!shown}
              onClick={() => setOpen(shown ? null : guide.key)}
            />
          </InsetGroup>
        );
      })}

      {open === 'receipt' && (
        <Button className="w-full" disabled={scan.busy} onClick={() => void scan.scan()}>
          {scan.busy ? 'Reading the receipt…' : 'Scan a receipt now'}
        </Button>
      )}

      {open === 'screen-scanner' && SCREEN_SCANNER_SHORTCUT_URL && isShortcutLink(SCREEN_SCANNER_SHORTCUT_URL) && (
        <Button className="w-full" onClick={() => window.open(SCREEN_SCANNER_SHORTCUT_URL!, '_system')}>
          Add Screen scanner
        </Button>
      )}

      {(open === 'notifications' || open === 'screen-scanner') && (
        <Button
          className="w-full"
          onClick={() => {
            // The shell may open it directly; a browser tab cannot, and a dead button would be a lie, so the
            // window is asked and failure is silent.
            window.open('shortcuts://', '_system');
          }}
        >
          Open Shortcuts
        </Button>
      )}

      <InsetGroup
        header="What to capture"
        footer="“Expenses only” skips money in, top-ups and offers; anything skipped waits in the Skipped list either way."
      >
        <div className="px-3 py-2.5">
          <SegmentedControl
            segments={[
              { key: 'everything', label: 'Everything' },
              { key: 'expenses-only', label: 'Expenses only' },
            ]}
            value={scope}
            onChange={(key) => void chooseScope(key as CaptureScope)}
            label="What to capture"
          />
        </div>
      </InsetGroup>

      <InsetGroup
        header="Capture sources"
        footer="What each source has learned: the account it files into, and the layout of a screen. Tap one to change it."
      >
        {(sources.data ?? []).map((source) => (
          <InsetRow
            key={source.id}
            title={source.label}
            subtitle={`${nameOf(source.accountId)} · ${source.template ? 'learned' : 'learning'}`}
            to="/settings/capture/sources/$sourceId"
            params={{ sourceId: source.id }}
          />
        ))}
        {sources.isSuccess && sources.data.length === 0 && (
          <InsetRow title="Nothing captured yet." chevron={false} />
        )}
      </InsetGroup>
    </div>
  );
}
