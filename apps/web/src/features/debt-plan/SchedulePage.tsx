import { isoDate, monthOf } from '@expanses/core';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { InsetGroup, PushedTitle, SCREEN, SwitchRow } from '../../ui/native';
import { SchedulePanel } from './SchedulePanel';
import type { MonthInput } from './schedule-view';

/** Which kinds the Schedule shows: Loans (with Lend & borrow), Cards, Bills — for this visit only. */
export function ShowSheet({ show, onShow, onClose }: { show: MonthInput['show']; onShow: (next: MonthInput['show']) => void; onClose: () => void }) {
  return (
    <Sheet title="Show" onClose={onClose} grouped>
      <InsetGroup>
        <SwitchRow label="Loans" checked={show.loans} onChange={(on) => onShow({ ...show, loans: on })} />
        <SwitchRow label="Cards" checked={show.cards} onChange={(on) => onShow({ ...show, cards: on })} />
        <SwitchRow label="Bills" checked={show.bills} onChange={(on) => onShow({ ...show, bills: on })} />
      </InsetGroup>
    </Sheet>
  );
}

/** The Schedule (spec §4.2): one month of instalments, statements and bills, `?month=YYYY-MM`. */
export function SchedulePage() {
  const today = isoDate();
  const navigate = useNavigate();
  const search = useSearch({ from: '/net-worth/plan/schedule' });
  const month = search.month ?? monthOf(today);
  const [show, setShow] = useState<MonthInput['show']>({ loans: true, cards: true, bills: true });
  const [choosing, setChoosing] = useState(false);
  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Schedule"
        back="Debt-free plan"
        backTo="/net-worth/plan"
        actions={[{ key: 'show', label: 'Show', glyph: <SlidersHorizontal size={18} aria-hidden />, run: () => setChoosing(true), expanded: choosing }]}
      />
      <SchedulePanel month={month} onMonth={(next) => void navigate({ to: '/net-worth/plan/schedule', search: { month: next }, replace: true })} show={show} today={today} />
      {choosing && <ShowSheet show={show} onShow={setShow} onClose={() => setChoosing(false)} />}
    </div>
  );
}
