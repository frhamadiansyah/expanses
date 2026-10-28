import { formatMinor, groupedMajorString, groupTypedAmount, isoDate, parseGroupedMajor } from '@expanses/core';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { cx } from '../../ui';
import { DestructiveRow, InsetGroup, PushedTitle, ReadOnlyRow, SCREEN, SelectRow, SubmitRow, TextRow } from '../../ui/native';
import { PeopleRow } from './PeopleRow';
import { heldForm, holdForm, releaseForm } from './receipt-split-hold';
import {
  billOf,
  effectiveCharges,
  memoFromReading,
  type MemoItem,
  type ReceiptMemo,
  mismatchOf,
  newItemId,
  sharesOf,
  toggleSharer,
  usable,
  withReceiptApplied,
} from './receipt-split-model';

const SURFACE = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)]';
const HEADER = 'px-[13px] pb-[6px] text-[13px] leading-4 text-[var(--ph-ink-3)] uppercase';
const RULED = '[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]';

/** What the edit sheet holds while it is open: typed text, applied when the sheet is done. */
interface ItemDraft {
  id: string | null;
  name: string;
  quantity: string;
  amount: string;
}

/**
 * `/transactions/receipt-split` — a restaurant bill divided by who had what, reached from With → By receipt.
 *
 * Two steps on one address: Who had what (tag each dish, say how each charge is shared) and Totals (what each person
 * pays). It saves nothing. The form it came from is held (`receipt-split-hold`); Use these amounts gives it back with
 * the With rows filled in as custom amounts, and the owner presses the form's ✓ as usual.
 */
export function ReceiptSplitPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [form] = useState(() => heldForm());
  const returning = useRef(false);
  // Leaving by any other way (the tab bar, a link) drops the held form: the next Add screen opens blank.
  useEffect(() => () => (returning.current ? undefined : releaseForm()), []);
  useEffect(() => {
    if (!form) void navigate({ to: '/transactions/new', replace: true });
  }, [form, navigate]);

  const [memo, setMemo] = useState<ReceiptMemo | null>(() =>
    form ? (form.reading ? memoFromReading(form.reading, form.currency, form.draft.with.filter((row) => row.debtAccountId || row.name.trim())) : (form.draft.receiptSplit ?? null)) : null,
  );
  const [step, setStep] = useState<'who' | 'totals'>('who');
  const [selected, setSelected] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ItemDraft | null>(null);
  const [amountError, setAmountError] = useState('');

  if (!form || !memo) return <div className={SCREEN} />;
  const currency = form.currency;
  const names = ['Me', ...memo.people.map((person) => person.name || 'Someone')];
  const shares = sharesOf(memo);
  const gap = mismatchOf(memo);
  const unresolved = gap !== null && gap !== 0 && !memo.useTotal;
  const ready = usable(memo);
  const money = (minor: number) => formatMinor(minor, currency);
  const chosen = memo.items.find((item) => item.id === selected) ?? null;
  const patchItem = (id: string, patch: Partial<MemoItem>) => setMemo({ ...memo, items: memo.items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });

  const leave = (draft = form.draft) => {
    holdForm({ draft, currency, reading: null });
    returning.current = true;
    if (router.history.canGoBack()) router.history.back();
    else void navigate({ to: '/transactions/new' });
  };

  const openItem = (item: MemoItem | null) => {
    setAmountError('');
    setSheet(item ? { id: item.id, name: item.name, quantity: String(item.quantity), amount: groupedMajorString(item.amountMinor, currency) } : { id: null, name: '', quantity: '1', amount: '' });
  };

  function applySheet() {
    if (!sheet) return;
    let amountMinor: number;
    try {
      amountMinor = parseGroupedMajor(sheet.amount, currency);
    } catch (e) {
      setAmountError(e instanceof Error ? e.message : 'Not an amount');
      return;
    }
    if (amountMinor <= 0) {
      setAmountError('An amount above zero');
      return;
    }
    const quantity = Math.max(1, Math.floor(Number(sheet.quantity)) || 1);
    const name = sheet.name.trim();
    if (sheet.id) patchItem(sheet.id, { name, quantity, amountMinor });
    else setMemo({ ...memo!, items: [...memo!.items, { id: newItemId(), name, quantity, amountMinor, sharedBy: [] }] });
    setSheet(null);
  }

  const charges = effectiveCharges(memo);

  if (step === 'totals') {
    return (
      <div className={SCREEN}>
        <PushedTitle
          title="Totals"
          back="Who had what"
          onBack={() => setStep('who')}
          actions={[{ key: 'use', label: 'Use these amounts', glyph: <Check size={20} aria-hidden />, run: () => leave(withReceiptApplied(form.draft, memo, isoDate())) }]}
        />
        <div className="space-y-3 md:max-w-2xl">
          <div className={cx(SURFACE, RULED)} data-testid="receipt-totals">
            {names.map((name, i) => (
              <div key={i} data-testid="receipt-person" data-person={name} className="flex min-h-[60px] items-center gap-3 px-[14px]">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[17px] font-semibold text-[var(--ph-ink-2)]">
                  {name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px]">{name}</span>
                  <span className="block text-[13px] leading-4 text-[var(--ph-ink-3)]">{shares.itemCount[i] === 1 ? '1 item' : `${shares.itemCount[i]} items`}</span>
                </span>
                <span className="tabular shrink-0 text-[16px] text-[var(--ph-ink)] md:text-[15px]" data-testid="receipt-person-total">
                  {money(shares.totals[i] ?? 0)}
                </span>
              </div>
            ))}
          </div>
          <InsetGroup>
            <ReadOnlyRow label="Receipt" value={money(billOf(memo))} testId="receipt-bill" />
            <ReadOnlyRow label="Paid by" value="Me" />
          </InsetGroup>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              leave(withReceiptApplied(form.draft, memo, isoDate()));
            }}
          >
            <InsetGroup>
              <SubmitRow label="Use these amounts" testId="receipt-use" />
            </InsetGroup>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Who had what"
        back="With"
        onBack={() => leave()}
        actions={[{ key: 'totals', label: 'Totals', glyph: <ArrowRight size={20} aria-hidden />, disabled: !ready, run: () => setStep('totals') }]}
      />
      <div className="space-y-3 md:max-w-2xl">
        <InsetGroup>
          <ReadOnlyRow label="Receipt total" value={money(memo.printedTotal ?? billOf(memo))} testId="receipt-printed" />
        </InsetGroup>
        {gap !== null && gap !== 0 && (
          <div className={cx(SURFACE, 'flex min-h-12 items-center gap-3 px-[13px]')} data-testid="receipt-mismatch">
            <span className="min-w-0 flex-1 text-[15px] leading-5 text-[var(--ph-ink)]">
              {memo.useTotal ? `Other ${money(gap)} added` : `Items differ from the total by ${money(Math.abs(gap))}`}
            </span>
            <button
              type="button"
              onClick={() => setMemo({ ...memo, useTotal: !memo.useTotal })}
              className="ph-focus ph-tap shrink-0 text-[15px] font-semibold text-[var(--ph-tint)]"
            >
              {memo.useTotal ? 'Undo' : 'Use the receipt total'}
            </button>
          </div>
        )}

        <section>
          <h2 className={HEADER}>Items</h2>
          <div className={cx(SURFACE, RULED)}>
            {memo.items.map((item) => {
              const who = item.sharedBy.length === 0 ? 'Everyone' : item.sharedBy.map((i) => names[i] ?? '').join(' · ');
              const on = item.id === selected;
              return (
                <div key={item.id} data-testid="receipt-item" aria-current={on || undefined} className={cx('flex items-center', on && 'bg-[var(--ph-fill)]')}>
                  <button type="button" onClick={() => setSelected(on ? null : item.id)} aria-label={`${item.name || 'Item'}, ${who}`} className="ph-focus-inset flex min-h-[60px] min-w-0 flex-1 items-center gap-3 pl-[14px] text-left">
                    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--ph-fill)] text-[17px] font-semibold text-[var(--ph-ink-2)]">
                      {(item.name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[17px] leading-[22px] text-[var(--ph-ink)] md:text-[15px]">
                        {item.name || 'No name'}
                        {item.quantity > 1 ? ` ×${item.quantity}` : ''}
                      </span>
                      <span className="block truncate text-[13px] leading-4 text-[var(--ph-ink-3)]">{who}</span>
                    </span>
                  </button>
                  <button type="button" aria-label={`Edit ${item.name || 'item'}`} onClick={() => openItem(item)} className="ph-focus-inset tabular flex min-h-[60px] shrink-0 items-center px-[14px] text-[16px] text-[var(--ph-ink)] md:text-[15px]">
                    {money(item.amountMinor)}
                  </button>
                </div>
              );
            })}
            <button type="button" onClick={() => openItem(null)} className="ph-focus-inset flex min-h-12 w-full items-center gap-3 px-[14px] text-left text-[17px] text-[var(--ph-tint)] md:text-[15px]">
              <Plus size={18} aria-hidden />
              Add an item
            </button>
          </div>
        </section>

        <section>
          <div className="flex items-baseline justify-between pr-[13px]">
            <h2 className={HEADER} data-testid="receipt-who-header">{chosen ? chosen.name || 'Item' : 'Select an item'}</h2>
            {chosen && (
              <span className="flex gap-4 text-[15px] font-semibold text-[var(--ph-tint)]">
                <button type="button" onClick={() => patchItem(chosen.id, { sharedBy: [] })} className="ph-focus ph-tap">
                  Everyone
                </button>
                <button type="button" onClick={() => patchItem(chosen.id, { sharedBy: [0] })} className="ph-focus ph-tap">
                  Just me
                </button>
              </span>
            )}
          </div>
          <div className={cx(!chosen && 'pointer-events-none opacity-40')} aria-disabled={!chosen}>
            <PeopleRow
              testId="receipt-people"
              people={names.map((name, i) => ({ key: String(i), name }))}
              picked={(key) => !!chosen && chosen.sharedBy.includes(Number(key))}
              onToggle={(key) => chosen && patchItem(chosen.id, toggleSharer(chosen, Number(key)))}
            />
          </div>
        </section>

        {charges.length > 0 && (
          <section>
            <h2 className={HEADER}>Charges</h2>
            <InsetGroup>
              {charges.map((charge) => (
                <SelectRow
                  key={charge.id}
                  label={`${charge.label} · ${money(charge.amountMinor)}`}
                  value={charge.mode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    if (charge.id === 'other') {
                      setMemo(mode === 'remove' ? { ...memo, useTotal: false } : { ...memo, otherMode: mode as 'pro-rata' | 'equal' });
                      return;
                    }
                    setMemo({
                      ...memo,
                      charges: mode === 'remove' ? memo.charges.filter((c) => c.id !== charge.id) : memo.charges.map((c) => (c.id === charge.id ? { ...c, mode: mode as 'pro-rata' | 'equal' } : c)),
                    });
                  }}
                >
                  <option value="pro-rata">Shared pro rata</option>
                  <option value="equal">Shared equally</option>
                  <option value="remove">Remove</option>
                </SelectRow>
              ))}
            </InsetGroup>
          </section>
        )}
      </div>

      {sheet && (
        <Sheet grouped title={sheet.id ? 'Item' : 'New item'} onClose={() => setSheet(null)} confirm={{ label: 'Done', run: applySheet }}>
          <div className="space-y-3 pb-2">
            <InsetGroup>
              <TextRow label="Name" value={sheet.name} placeholder="Name" onChange={(e) => setSheet({ ...sheet, name: e.target.value })} />
              <TextRow
                label="Amount"
                prefix={currency}
                value={sheet.amount}
                inputMode="decimal"
                placeholder="Amount"
                onChange={(e) => {
                  setAmountError('');
                  setSheet({ ...sheet, amount: groupTypedAmount(e.target.value, currency) });
                }}
              />
              <TextRow label="Quantity" value={sheet.quantity} inputMode="numeric" placeholder="Quantity" onChange={(e) => setSheet({ ...sheet, quantity: e.target.value.replace(/\D/g, '') })} />
            </InsetGroup>
            {amountError && <p role="alert" className="px-[13px] text-[13px] leading-4 text-[var(--ph-alarm-ink)]">{amountError}</p>}
            {sheet.id && (
              <InsetGroup>
                <DestructiveRow
                  label="Remove"
                  onClick={() => {
                    setMemo({ ...memo, items: memo.items.filter((item) => item.id !== sheet.id) });
                    if (selected === sheet.id) setSelected(null);
                    setSheet(null);
                  }}
                />
              </InsetGroup>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
