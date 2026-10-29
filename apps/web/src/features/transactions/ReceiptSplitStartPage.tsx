import { readReceiptLines } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, SearchPill } from '../../ui/native';
import { resolveDefaultPaidWith, usePayableOptions, useStoredDefaultPaidWith } from '../account/default-paid-with';
import { useRecentPeople } from '../debts/queries';
import { PeopleRow } from './PeopleRow';
import { recognizePhotos } from './receipt-fill';
import { heldForm, holdForm } from './receipt-split-hold';
import { startDraft } from './receipt-split-start';
import { postingCurrency, type WithRow } from './tx-form';

const ME = 'me';
const HEADER = 'px-[13px] pb-[6px] text-[13px] leading-4 text-[var(--ph-ink-3)] uppercase';

/**
 * `/transactions/receipt-split/start` — a receipt divided without a purchase started first: who is sharing, then the
 * photo. From the photo the pages are the ones With → By receipt uses (Who had what, charges, Totals); the last one
 * records the purchase on a New transaction filled in, paid with the Default account when there is one.
 *
 * Nothing is saved here. Me is always in the row; anybody else is picked from the people on the books or added by
 * name with the keyboard's Done, and is carried as a plain name until the purchase is saved.
 */
export function ReceiptSplitStartPage() {
  const { ws } = useApp();
  const navigate = useNavigate();
  const accounts = useAccounts();
  const recent = useRecentPeople().data ?? [];
  const stored = useStoredDefaultPaidWith();
  const payable = usePayableOptions();
  const photoInput = useRef<HTMLInputElement>(null);

  // Back from the pages after it: the people as they were left.
  const [back] = useState(() => {
    const form = heldForm();
    return form?.origin === 'account' ? form.draft.with : [];
  });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>(() => back.map((row) => row.debtAccountId || `name:${row.name.trim()}`));
  const [extras, setExtras] = useState<string[]>(() => back.filter((row) => !row.debtAccountId).map((row) => row.name.trim()));
  const [added, setAdded] = useState<string | null>(null);
  const [addedName, setAddedName] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const known = recent.map((person) => ({ key: person.accountId, name: person.personName, accountId: person.accountId }));
  const named = extras.filter((name) => !known.some((k) => k.name.toLowerCase() === name.toLowerCase())).map((name) => ({ key: `name:${name}`, name, accountId: '' }));
  const everyone = [...known, ...named];
  const typed = search.trim();
  const needle = typed.toLowerCase();
  const shown = needle ? everyone.filter((person) => person.name.toLowerCase().includes(needle)) : everyone;

  const toggle = (key: string) => setPicked((now) => (now.includes(key) ? now.filter((k) => k !== key) : [...now, key]));
  // Done on the keyboard: a name on the books is picked; any other is added at the end of the row, picked.
  const addTyped = () => {
    if (!typed) return;
    setSearch('');
    const exact = everyone.find((person) => person.name.toLowerCase() === needle);
    if (exact) {
      setPicked((now) => (now.includes(exact.key) ? now : [...now, exact.key]));
      return;
    }
    setExtras((now) => [...now, typed]);
    setPicked((now) => [...now, `name:${typed}`]);
    setAdded(`name:${typed}`);
    setAddedName(typed);
  };

  const people: WithRow[] = everyone.filter((person) => picked.includes(person.key)).map((person) => ({ debtAccountId: person.accountId, name: person.name, amount: '' }));
  const pay = stored.isSuccess && payable.ready ? resolveDefaultPaidWith(stored.data, payable.options) : null;
  const ready = accounts.isSuccess && stored.isSuccess && payable.ready;

  async function readPhotos(files: File[]) {
    if (files.length === 0 || !accounts.data) return;
    setReading(true);
    setError(null);
    const draft = startDraft(ws.bookId ?? '', people, pay ? { accountId: pay.accountId, cardId: pay.cardId } : null);
    const currency = postingCurrency(draft, accounts.data, ws.baseCurrency);
    const lines = await recognizePhotos(files);
    setReading(false);
    if (!lines) {
      setError('That photo could not be read');
      return;
    }
    const reading = readReceiptLines(lines, currency);
    if (reading.items.length === 0 && reading.total === null) {
      setError('Nothing could be read from that photo');
      return;
    }
    holdForm({ draft, currency, reading, origin: 'account' });
    void navigate({ to: '/transactions/receipt-split' });
  }

  return (
    <div className={SCREEN}>
      <PushedTitle title="Split a receipt" back="Account" backTo="/account" actions={[]} />
      <div className="space-y-3 md:max-w-2xl">
        <section>
          <h2 className={HEADER}>Who is sharing</h2>
          <div className="flex flex-col gap-[10px]">
            <SearchPill value={search} onChange={setSearch} onClose={() => setSearch('')} placeholder="Search or add a person" label="Search or add a person" onEnter={addTyped} enterKeyHint="done" />
            <span role="status" className="sr-only">
              {addedName ? `Added ${addedName}` : ''}
            </span>
            <PeopleRow
              testId="split-start-people"
              people={[{ key: ME, name: 'Me' }, ...shown.map((person) => ({ key: person.key, name: person.name }))]}
              picked={(key) => key === ME || picked.includes(key)}
              onToggle={(key) => key !== ME && toggle(key)}
              scrollTo={added ?? undefined}
            />
          </div>
        </section>
        <InsetGroup>
          <InsetRow
            action
            title={reading ? 'Reading the receipt…' : 'Choose a photo of the receipt'}
            label="Choose a photo of the receipt"
            disabled={reading || !ready}
            onClick={() => photoInput.current?.click()}
            testId="split-start-photo"
          />
        </InsetGroup>
        {error && (
          <p role="alert" className="px-[13px] text-[13px] leading-4 text-[var(--ph-alarm-ink)]">
            {error}
          </p>
        )}
        <input
          ref={photoInput}
          data-testid="receipt-split-input"
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void readPhotos(files);
          }}
        />
      </div>
    </div>
  );
}
