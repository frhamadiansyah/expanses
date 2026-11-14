import { useEffect, useRef, useState } from 'react';
import { type GroupChild, InsetGroup, InsetRow, TextRow } from '../../ui/native';

/** How long typing rests before a name is saved; leaving the field saves at once. */
const NAME_PAUSE_MS = 800;

/**
 * A name typed in place and saved as it is typed: a pause in the typing saves it, and so does leaving the field or Enter.
 *
 * An empty name is never saved: leaving the field empty puts the last name back. The value from outside is taken in only
 * while the field is not being typed into, so a save landing mid-word never rewrites what is under the caret.
 */
export function InPlaceNameRow({
  value,
  onCommit,
  testId,
  position,
}: GroupChild & {
  /** The name as saved. */
  value: string;
  /** Saves a trimmed, non-empty name that differs from `value`. */
  onCommit: (name: string) => void;
  testId?: string;
}) {
  const [draft, setDraft] = useState(value);
  const typing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(value);

  useEffect(() => {
    committed.current = value;
    if (!typing.current) setDraft(value);
  }, [value]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function commit(text: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const name = text.trim();
    if (name === '' || name === committed.current) return;
    committed.current = name;
    onCommit(name);
  }

  return (
    <TextRow
      position={position}
      label="Name"
      value={draft}
      data-testid={testId}
      enterKeyHint="done"
      onFocus={() => {
        typing.current = true;
      }}
      onChange={(event) => {
        const text = event.target.value;
        setDraft(text);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(text), NAME_PAUSE_MS);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      onBlur={() => {
        typing.current = false;
        commit(draft);
        // Left empty: the last good name comes back.
        if (draft.trim() === '') setDraft(committed.current);
      }}
    />
  );
}

/**
 * A setting that opens a list: label plain, value in ink with a ›. Locked, the value goes grey, the › goes, and the row
 * does nothing when tapped.
 */
export function SettingsPickerRow({
  title,
  value,
  locked,
  onOpen,
  testId,
  label,
  position,
}: GroupChild & { title: string; value: string; locked: boolean; onOpen: () => void; testId?: string; label?: string }) {
  return (
    <InsetRow
      position={position}
      title={title}
      plain
      value={value}
      valueTone={locked ? 'ink-3' : 'ink'}
      chevron={!locked}
      onClick={locked ? undefined : onOpen}
      label={label}
      testId={testId}
    />
  );
}

/**
 * One action in a group of its own, with the sentence under it saying what it does: centred, in the tint (Mark as done,
 * Reopen) or in alarm (Delete).
 */
export function SettingsActionGroup({
  label,
  footer,
  onClick,
  destructive = false,
  disabled = false,
  testId,
}: {
  label: string;
  footer?: string;
  onClick: () => void;
  destructive?: boolean;
  /** Cannot be taken yet: greyed, and the footer says why (a shared trip's Leave while a balance is not zero). */
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <InsetGroup footer={footer}>
      <InsetRow
        action={!destructive}
        destructive={destructive}
        // The action row draws its words in ink; this one is the tint, as iOS draws a row that does something.
        title={destructive || disabled ? label : <span className="text-[var(--ph-tint)]">{label}</span>}
        label={label}
        onClick={onClick}
        disabled={disabled}
        testId={testId}
      />
    </InsetGroup>
  );
}
