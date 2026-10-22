import { type CouponsPerYear, parseRate } from '@expanses/core';
import { type BondCouponRow, removeBondCoupon, saveBondCoupon } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { InsetGroup, InsetRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { errorHint } from './AssetSettings';
import { useBondCoupons } from './queries';

const PAID: { perYear: CouponsPerYear; label: string }[] = [
  { perYear: 12, label: 'Monthly' },
  { perYear: 4, label: 'Every 3 months' },
  { perYear: 2, label: 'Every 6 months' },
  { perYear: 1, label: 'Yearly' },
];

/** Where a coupon can be paid into: a money account that is not a pocket's parent. */
const PAID_INTO = new Set(['bank', 'savings', 'fund', 'ewallet', 'cash']);

const percent = (bps: number) => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(bps / 100);

/**
 * A bond's coupon, on its Settings: the rate a year, how often and from when it pays, when it matures, the tax withheld,
 * where it is paid into, and whether the app records it on the day. Kept as soon as the rate and the next payment are
 * there; each row saves when it is left or changed, as the page's other rows do.
 */
export function CouponGroup({ accountId, heldAtId }: { accountId: string; heldAtId: string | null }) {
  const terms = useBondCoupons();
  if (!terms.data) return null;
  const saved = terms.data[accountId] ?? null;
  return <CouponRows key={`${accountId}-${saved ? JSON.stringify(saved) : ''}`} accountId={accountId} saved={saved} heldAtId={heldAtId} />;
}

function CouponRows({ accountId, saved, heldAtId }: { accountId: string; saved: BondCouponRow | null; heldAtId: string | null }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const places = accounts.filter((a) => a.kind === 'asset' && PAID_INTO.has(a.subtype) && a.archivedAt === null && a.id !== accountId);
  const [rate, setRate] = useState(saved ? percent(saved.rateBps) : '');
  const [perYear, setPerYear] = useState<CouponsPerYear>(saved?.perYear ?? 12);
  const [nextOn, setNextOn] = useState(saved?.nextOn ?? '');
  const [maturesOn, setMaturesOn] = useState(saved?.maturesOn ?? '');
  const [tax, setTax] = useState(saved ? percent(saved.taxBps) : '10');
  const [cashAccountId, setCashAccountId] = useState(saved?.cashAccountId ?? (heldAtId && places.some((p) => p.id === heldAtId) ? heldAtId : ''));
  const [auto, setAuto] = useState(saved?.auto ?? true);
  const [error, setError] = useState<unknown>(null);

  /** Saves what is on screen, with one row's new value, once the rate and the next payment are there. */
  async function save(patch: Partial<{ rate: string; perYear: CouponsPerYear; nextOn: string; maturesOn: string; tax: string; cashAccountId: string; auto: boolean }> = {}) {
    const now = { rate, perYear, nextOn, maturesOn, tax, cashAccountId, auto, ...patch };
    setError(null);
    if (!now.rate.trim() || !now.nextOn) return;
    try {
      await saveBondCoupon(database, ws, {
        accountId,
        rateBps: Math.round(parseRate(now.rate) * 100),
        perYear: now.perYear,
        nextOn: now.nextOn,
        maturesOn: now.maturesOn || null,
        taxBps: Math.round(parseRate(now.tax.trim() || '0') * 100),
        cashAccountId: now.cashAccountId || null,
        auto: now.auto,
      });
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const footer = !saved
    ? 'Kept once the rate and the next payment are in. With an account to pay into, the app records each coupon on its day, after the tax withheld.'
    : auto && !cashAccountId
      ? 'Choose an account to pay into, and the app records each coupon on its day.'
      : auto
        ? 'Recorded on its day into that account, after the tax withheld — editable like any coupon.'
        : 'Not recorded by the app: record each coupon with Coupon on the bond’s page.';

  return (
    <>
      <InsetGroup header="Coupon" footer={footer}>
        <TextRow
          label="Rate (% a year)"
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => void save()}
          inputMode="decimal"
          placeholder="Required"
          hint={errorHint(error)}
        />
        <SelectRow
          label="Paid"
          value={String(perYear)}
          onChange={(e) => {
            const next = Number(e.target.value) as CouponsPerYear;
            setPerYear(next);
            void save({ perYear: next });
          }}
        >
          {PAID.map((p) => (
            <option key={p.perYear} value={p.perYear}>
              {p.label}
            </option>
          ))}
        </SelectRow>
        <TextRow
          label="Next payment on"
          type="date"
          value={nextOn}
          onChange={(e) => {
            setNextOn(e.target.value);
            void save({ nextOn: e.target.value });
          }}
          info="Its day of the month is the day every payment falls on; a shorter month pays on its last day."
        />
        <TextRow
          label="Matures on"
          type="date"
          value={maturesOn}
          onChange={(e) => {
            setMaturesOn(e.target.value);
            void save({ maturesOn: e.target.value });
          }}
        />
        <TextRow label="Tax withheld (%)" value={tax} onChange={(e) => setTax(e.target.value)} onBlur={() => void save()} inputMode="decimal" placeholder="None" />
        <SelectRow
          label="Paid into"
          value={cashAccountId}
          onChange={(e) => {
            setCashAccountId(e.target.value);
            void save({ cashAccountId: e.target.value });
          }}
        >
          <option value="">Not set</option>
          {places.map((place) => (
            <option key={place.id} value={place.id}>
              {place.name}
            </option>
          ))}
        </SelectRow>
        <SwitchRow
          label="Record it automatically"
          checked={auto}
          onChange={(on) => {
            setAuto(on);
            void save({ auto: on });
          }}
        />
      </InsetGroup>
      {saved && (
        <InsetGroup>
          <InsetRow
            title="Remove coupon terms"
            chevron={false}
            onClick={() =>
              void (async () => {
                await removeBondCoupon(database, ws, accountId);
                await invalidate();
              })()
            }
          />
        </InsetGroup>
      )}
    </>
  );
}
