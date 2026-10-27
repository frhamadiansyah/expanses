import { type CaptureScope, getCaptureScope, setCaptureScope } from '@expanses/db';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { type DrainReport, drainNow, lastDrain } from '../../capture/drain';
import { native } from '../../capture/native';
import { useAccounts } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, LargeTitle, PickerRow, SCREEN, SelectRow } from '../../ui/native';
import { useCaptureSources } from '../review/queries';
import { CAPTURE_GUIDES } from './guides';

/**
 * Settings → Capture: what it is allowed to keep, what it has learned, and where to start.
 *
 * Top to bottom: the scope (everything, or only money going out), every source the phone has recognised with the
 * account it files into, the ways to capture — each a page of its own, with the steps (`guides.ts`) and its button —
 * and what waits on the phone, as one row that checks when tapped. What a row means is behind its ⓘ, not under it.
 */
/** A drain's report in a line: what the phone handed over and what came of it, or why it failed. */
export function reportLine(report: DrainReport | null): string {
  if (!report) return 'Not checked since the app opened.';
  const time = new Date(report.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (report.error) return `${time} · failed${report.found === null ? '' : ` with ${report.found} handed over`}: ${report.error}`;
  const result = report.result;
  if (!result || report.found === 0) return `${time} · nothing waiting`;
  return `${time} · ${report.found} handed over → ${result.drafts} new, ${result.merged} merged, ${result.skipped} skipped`;
}

/**
 * What waits on the phone for the app, as one row: the count, and a tap to take it in now. A shortcut says "Saved to
 * review" the moment it writes; this is where the other half — the app taking it in — is asked for again, and the
 * last drain's report is behind the ⓘ. Items the phone could not open appear only when there are some.
 */
function HoldingArea() {
  const { database, ws } = useApp();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<{ pending: number; broken: number } | null>(null);
  const [report, setReport] = useState<DrainReport | null>(lastDrain);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setStatus(await native.holdingAreaStatus().catch(() => null));
    setReport(lastDrain());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function check() {
    setBusy(true);
    try {
      await drainNow(database, ws);
      void queryClient.invalidateQueries();
    } catch {
      // The report below carries the error.
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const count = status ? String(status.pending) : '–';
  return (
    <InsetGroup header="On the phone">
      <PickerRow
        label="Waiting"
        value={`${count} · ${busy ? 'Checking…' : 'Check now'}`}
        info={`Last check: ${reportLine(report)}`}
        chevron={false}
        onOpen={() => {
          if (!busy) void check();
        }}
        testId="capture-waiting"
      />
      {status && status.broken > 0 && <InsetRow plain title="Could not be opened" value={String(status.broken)} chevron={false} />}
    </InsetGroup>
  );
}

export function CaptureSettingsPage() {
  const { database } = useApp();
  const accounts = useAccounts().data ?? [];
  const sources = useCaptureSources();
  const [scope, setScope] = useState<CaptureScope>('everything');
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
      <LargeTitle title="Capture" back="Account" backTo="/account" />
      <ErrorBox error={error ?? sources.error} />

      <InsetGroup>
        <SelectRow
          label="What to capture"
          info="“Expenses only” skips money in, top-ups and offers; anything skipped waits in the Skipped list either way."
          value={scope}
          onChange={(e) => void chooseScope(e.target.value as CaptureScope)}
        >
          <option value="everything">Everything</option>
          <option value="expenses-only">Expenses only</option>
        </SelectRow>
      </InsetGroup>

      <InsetGroup header="Sources">
        {(sources.data ?? []).map((source) => (
          <InsetRow
            key={source.id}
            title={source.label}
            subtitle={`${nameOf(source.accountId)} · ${source.template ? 'learned' : 'learning'}`}
            to="/settings/capture/sources/$sourceId"
            params={{ sourceId: source.id }}
          />
        ))}
        {sources.isSuccess && sources.data.length === 0 && <InsetRow title="Nothing captured yet." chevron={false} />}
      </InsetGroup>

      <InsetGroup header="Ways to capture">
        {CAPTURE_GUIDES.map((guide) => (
          <InsetRow plain key={guide.key} title={guide.title} to="/settings/capture/ways/$way" params={{ way: guide.key }} />
        ))}
      </InsetGroup>

      <HoldingArea />
    </div>
  );
}
