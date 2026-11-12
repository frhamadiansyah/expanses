import { formatMinor } from '@expanses/core';
import { noteSuggestions } from '@expanses/db';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, CornerDownLeft } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { cx, ErrorBox } from '../../ui';
import { PushedTitle, SCREEN } from '../../ui/native';
import { useKeyboardInset } from '../../ui/native/KeyboardStrip';
import { useOpenBookReadOnly } from '../sharing/queries';
import { NoteSuggestions } from './NoteSuggestions';
import { TransactionRow } from './TransactionRow';
import { useOneLine } from './use-one-line';

const SURFACE = 'rounded-[11px] bg-[var(--ph-surface)] px-3';
const HEADER = 'px-[13px] pb-[6px] text-[13px] leading-4 text-[var(--ph-ink-3)]';
/** How tall the suggested-notes strip stands over the keyboard (`KeyboardStrip`'s cells), so Save sits on top of it. */
const STRIP_HEIGHT = 48;

/**
 * `/transactions/line` — One line as a page of its own, where the widget and Control Center open it: the rows saved in
 * this sitting, the line read into the row it will be saved as, and the field. The reading, the pickers and the save
 * are `useOneLine`'s, the same as the field a held ＋ docks over Cashflow.
 */
export function OneLinePage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useBack('/transactions');
  const readOnly = useOpenBookReadOnly();
  const inset = useKeyboardInset();
  const line = useOneLine();
  const { phone, reading, saved } = line;
  const [focused, setFocused] = useState(true);

  // The suggested-notes strip's own query, read here too (one cache entry), so Save can stand on top of the strip.
  const want = reading.description.trim();
  const suggestionsOn = phone && focused && want.length >= 2;
  const suggestions = useQuery({
    queryKey: ['note-suggestions', ws.workspaceId, ws.bookId ?? '', 'expense', want.toLowerCase()],
    queryFn: () => noteSuggestions(database, ws, want, 'expense'),
    enabled: suggestionsOn,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const lift = suggestionsOn && (suggestions.data?.length ?? 0) > 0 ? STRIP_HEIGHT : 0;

  if (readOnly) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="One line" back="Cashflow" onBack={back} />
        <p className="px-[13px] text-[15px] text-[var(--ph-ink-2)]" data-testid="line-read-only">
          This workspace is read-only, so nothing can be added to it.
        </p>
      </div>
    );
  }

  const total = saved.reduce((sum, row) => sum + row.baseMinor, 0);

  const saveBar = (
    <div className="flex items-center gap-3 px-[13px] py-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ph-ink-3)]">Tap the row to change a part</span>
      <button
        type="button"
        disabled={!line.canSave}
        // Down, not click: the line keeps the focus, so the keyboard stays up for the next row.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void line.save()}
        className="ph-focus inline-flex items-center gap-1 rounded-md px-2 py-1 text-[15px] font-semibold text-[var(--ph-tint)] disabled:opacity-40"
      >
        Save
        <CornerDownLeft size={15} aria-hidden />
      </button>
    </div>
  );
  // Over the keyboard while the line is being typed in on a phone; with no keyboard up (a wide screen, a phone's browser
  // with a hardware keyboard) at the foot of what is typed, rather than over the tab bar.
  const floating = phone && focused && inset > 0;

  return (
    <div className={SCREEN}>
      <PushedTitle title="One line" back="Cashflow" onBack={back} actions={[{ key: 'done', label: 'Done', glyph: <Check size={20} aria-hidden />, run: back }]} />
      <div className={cx('space-y-3 md:max-w-2xl', floating && 'pb-24')}>
        {saved.length > 0 && (
          <section>
            <h2 className={HEADER} data-testid="line-saved">
              {saved.length} saved · {formatMinor(total, ws.baseCurrency)}
            </h2>
            <ul className={cx(SURFACE, 'divide-y divide-[var(--ph-hair)]')}>
              {saved.map((row) => (
                <TransactionRow
                  key={row.id}
                  row={row.row}
                  accounts={line.accounts}
                  testId="line-saved-row"
                  phone={phone}
                  onOpen={() => void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId: row.id } })}
                />
              ))}
            </ul>
          </section>
        )}

        <p className="px-[13px] text-[13px] leading-4 text-[var(--ph-ink-3)]">Shop, amount and how it was paid. Add “yesterday” or a date for another day.</p>

        {line.eventChip}
        <section>
          <h2 className={HEADER}>Will be saved as</h2>
          <ul className={cx(SURFACE, 'outline outline-1 -outline-offset-1 outline-[var(--ph-tint)]')}>{line.previewNode()}</ul>
        </section>

        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void line.save();
          }}
        >
          <div className="rounded-[11px] bg-[var(--ph-surface)]">
            <input
              ref={line.field}
              aria-label="One line"
              placeholder="Shop, amount, card"
              autoFocus
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={line.text}
              onChange={(e) => line.type(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="ph-focus-inset block h-[48px] w-full rounded-[11px] bg-transparent px-[14px] text-[17px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
            />
          </div>
        </form>
        <ErrorBox error={line.error} />
        {!floating && saveBar}
      </div>

      {floating && (
        <div
          className="fixed inset-x-0 z-50 border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)]"
          style={{
            bottom: inset + lift,
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          }}
        >
          {saveBar}
        </div>
      )}
      <NoteSuggestions typed={reading.description} kind="expense" open={focused} categoryName={line.categoryOf} onPick={(s) => void line.pickSuggestion(s)} />
      {line.pickers}
    </div>
  );
}
