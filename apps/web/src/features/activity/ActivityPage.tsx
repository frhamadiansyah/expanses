import { type ActivityKind, type ActivityLine } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { ArrowLeftRight, Check, Eraser, Pencil, Plus, Tag, Undo2 } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, LargeTitle, ROW_PAD_X, ROW_PAD_Y, RowIcon, SCREEN, SegmentedControl, TAP, tapReach } from '../../ui/native';
import { groupByDay, stateWords, timeOf } from './group';
import { useActivity, useUndoActivity } from './queries';

const PAGE = 100;

const SEGMENTS = [
  { key: 'all', label: 'All' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'accounts', label: 'Accounts' },
] as const;

const ICON = 15;

export function iconFor(kind: ActivityKind): ReactNode {
  switch (kind) {
    case 'edit':
      return <Pencil size={ICON} aria-hidden />;
    case 'delete':
      return <Eraser size={ICON} aria-hidden />;
    case 'payment':
      return <Check size={ICON} aria-hidden />;
    case 'move':
      return <ArrowLeftRight size={ICON} aria-hidden />;
    case 'create':
      return <Plus size={ICON} aria-hidden />;
    case 'rename':
      return <Tag size={ICON} aria-hidden />;
    default:
      return <Undo2 size={ICON} aria-hidden />;
  }
}

/** The quiet words at the right of a line, or the Undo capsule. Ink and grey: Delete is the only red in the app. */
function Right({ line, busy, onUndo }: { line: ActivityLine; busy: boolean; onUndo: () => void }) {
  if (line.state === 'open' && line.undo) {
    return (
      <button
        type="button"
        data-testid="activity-undo"
        aria-label={`Undo ${line.title}`}
        disabled={busy}
        onClick={onUndo}
        className="ph-focus ph-tap shrink-0 rounded-full bg-[var(--ph-fill)] px-[12px] py-[5px] text-[14px] leading-[18px] font-semibold text-[var(--ph-ink)] disabled:opacity-40"
        style={{ '--ph-tap-y': `${tapReach(28)}px` } as CSSProperties}
      >
        Undo
      </button>
    );
  }
  const words = stateWords(line.state);
  return words ? <span className="shrink-0 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{words}</span> : null;
}

/**
 * One line of the list: the row opens its page, the Undo capsule beside it undoes. Two targets side by side and never
 * one inside the other, as a workspace's line on the Account page does.
 */
function ActivityRow({ line, busy, onUndo, position }: GroupChild & { line: ActivityLine; busy: boolean; onUndo: () => void }) {
  return (
    <div className="relative flex items-stretch" data-testid="activity-line" style={{ minHeight: TAP }}>
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 28 + 10, right: ROW_PAD_X }} />}
      <Link
        to="/settings/activity/$id"
        params={{ id: line.id }}
        className="ph-focus-inset flex min-w-0 flex-1 items-center text-left"
        style={{ gap: 10, padding: `${ROW_PAD_Y}px 0 ${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
      >
        <RowIcon>{iconFor(line.kind)}</RowIcon>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{line.title}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{[line.subtitle, timeOf(line.at)].filter(Boolean).join(' · ')}</span>
        </span>
      </Link>
      <span className="flex shrink-0 items-center" style={{ padding: `0 ${ROW_PAD_X}px 0 8px` }}>
        <Right line={line} busy={busy} onUndo={onUndo} />
      </span>
    </div>
  );
}

/**
 * Settings → Activity: what was changed by hand, newest first, with Undo where the earlier figures are still whole.
 * Only what the app records is listed; a line it cannot reverse says so.
 */
export function ActivityPage() {
  const [segment, setSegment] = useState<'all' | 'transactions' | 'accounts'>('all');
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState<unknown>(null);
  // Accounts has a segment only when something is recorded for it.
  const accountsSeen = useActivity('accounts', 1);
  const hasAccounts = (accountsSeen.data?.length ?? 0) > 0;
  const kind = segment === 'accounts' && !hasAccounts ? 'all' : segment;
  const list = useActivity(kind, shown + 1);
  const undo = useUndoActivity(setError);

  const lines = (list.data ?? []).slice(0, shown);
  const more = (list.data?.length ?? 0) > shown;
  const groups = groupByDay(lines);
  const segments = SEGMENTS.filter((s) => s.key !== 'accounts' || hasAccounts);

  return (
    <div className={SCREEN}>
      <LargeTitle title="Activity" back="Account" backTo="/account" />
      <ErrorBox error={error ?? list.error} />
      {segments.length > 1 && (
        <SegmentedControl
          label="Show"
          segments={segments}
          value={kind}
          onChange={(key) => {
            setSegment(key as typeof segment);
            setShown(PAGE);
          }}
          className="mb-[14px]"
        />
      )}
      {list.isSuccess && lines.length === 0 && (
        <InsetGroup>
          <InsetRow title="Nothing changed yet" chevron={false} />
        </InsetGroup>
      )}
      {groups.map((group) => (
        <InsetGroup key={group.day} header={group.header}>
          {group.lines.map((line) => (
            <ActivityRow key={line.id} line={line} busy={undo.busy} onUndo={() => void undo.run(line.id)} />
          ))}
        </InsetGroup>
      ))}
      {more && (
        <InsetGroup>
          <InsetRow testId="activity-more" title="Show more" action onClick={() => setShown(shown + PAGE)} />
        </InsetGroup>
      )}
    </div>
  );
}
