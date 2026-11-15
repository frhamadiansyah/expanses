import type { SpendingGuide } from '@expanses/core';
import { resetSpendingGuide, saveSpendingGuide } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, TextRow } from '../../ui/native';
import { draftOf, type GuideDraft, readDraft, SPLIT_KEYS, SPLIT_LABELS } from './split-view';

/**
 * The guide Essential, Lifestyle and Debts & savings are held against: three percents that add up to 100, kept per
 * workspace. Cashflow's marks, the Budget box and the Financial health card all read it.
 */
export function GuideSheet({ guide, onClose }: { guide: SpendingGuide; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<GuideDraft>(() => draftOf(guide));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const read = readDraft(draft);

  async function run(write: () => Promise<void>) {
    if (busy) return;
    setError(null);
    try {
      setBusy(true);
      await write();
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  return (
    <Sheet
      grouped
      title="Guide"
      onClose={onClose}
      confirm={{ label: 'Save guide', disabled: busy || read.guide === null, run: () => void run(() => saveSpendingGuide(database, ws, read.guide!)) }}
    >
      <InsetGroup footer={<span data-testid="guide-footer">{read.footer}</span>}>
        {SPLIT_KEYS.map((key) => (
          <TextRow
            key={key}
            label={SPLIT_LABELS[key]}
            value={draft[key]}
            suffix="%"
            inputMode="numeric"
            aria-label={`${SPLIT_LABELS[key]} percent`}
            data-testid={`guide-${key}`}
            onChange={(event) => setDraft((was) => ({ ...was, [key]: event.target.value.replace(/[^\d]/g, '').slice(0, 3) }))}
          />
        ))}
      </InsetGroup>
      <ErrorBox error={error} />
      <InsetGroup>
        <InsetRow title="Reset to 50 / 30 / 20" action label="Reset to 50 / 30 / 20" testId="guide-reset" onClick={() => void run(() => resetSpendingGuide(database, ws))} />
        <InsetRow
          title="Which categories are Essential"
          testId="guide-categories"
          onClick={() => {
            onClose();
            void navigate({ to: '/categories' });
          }}
        />
      </InsetGroup>
    </Sheet>
  );
}
