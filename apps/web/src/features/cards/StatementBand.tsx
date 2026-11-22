import { formatMinor } from '@expanses/core';
import type { CardStatement } from '@expanses/db';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { type GroupChild, InsetGroup } from '../../ui/native';
import { Line } from './rows';
import { statementTotals } from './statement-totals';

/** The hatch marks money already paid: it is drawn, but it is no longer owed. Drawn in the kit's greys. */
const HATCH = { backgroundImage: 'repeating-linear-gradient(135deg, var(--ph-chevron) 0 3px, var(--ph-track) 3px 6px)' };

/** One figure of the band as a form row does it: what it is on the left, the money on the right. */
function FigureLine({
  position,
  label,
  owedMinor,
  ofMinor,
  money,
  faint = false,
  strong = false,
  testId,
  onOpen,
}: GroupChild & {
  label: string;
  owedMinor: number;
  ofMinor: number | null;
  money: (minor: number) => string;
  faint?: boolean;
  strong?: boolean;
  testId?: string;
  /** The row opens what makes up its figure (the payments behind Paid): it gets a › and the whole row is the target. */
  onOpen?: () => void;
}) {
  const figure = (
    <>
      {money(owedMinor)}
      {ofMinor !== null && ofMinor !== owedMinor && <span className="font-normal text-[var(--ph-ink-3)]"> of {money(ofMinor)}</span>}
    </>
  );
  const name = <span className={cx('text-[15px] leading-[20px]', strong ? 'font-semibold text-[var(--ph-ink)]' : 'text-[var(--ph-ink)]')}>{label}</span>;
  const value = cx('tabular text-right text-[15px] leading-[20px] whitespace-nowrap', strong && 'font-semibold', faint ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]');
  return (
    <Line position={position} testId={testId} className="flex items-baseline justify-between gap-3">
      {onOpen ? (
        // The row's reach is the whole row, drawn over it by the button's ::after; the › says it goes somewhere.
        <button type="button" data-testid="statement-paid-open" onClick={onOpen} className="ph-focus flex w-full items-center justify-between gap-3 text-left after:absolute after:inset-0">
          {name}
          <span className={cx(value, 'flex items-center gap-[4px]')}>
            <span>{figure}</span>
            <ChevronRight size={16} strokeWidth={2.5} aria-hidden className="text-[var(--ph-chevron)]" />
          </span>
        </button>
      ) : (
        <>
          {name}
          <span className={value}>{figure}</span>
        </>
      )}
    </Line>
  );
}

/**
 * A statement's totals, as one group: the bar, then each figure as a row, then the bill itself.
 *
 * The bar carries the whole of the previous bill and everything bought since, so the figures under it are the ones
 * the bank prints. What has been paid is hatched out, leaving the upcoming bill as the solid part. The bill used to
 * sit in a black box beside the bar; it is now the group's last row, in the row's own weight.
 */
export function StatementBand({
  statement,
  currency,
  lead,
  onOpenPaid,
  paidMinor = 0,
}: {
  statement: CardStatement;
  currency: string;
  /** A row drawn first in the group: the page's date stepper. */
  lead?: ReactNode;
  /**
   * The statement's payments are kept off its list: Paid (on an open statement, Previous bill, which they pay first)
   * opens them. Left out when there is nothing to open, so the row stays plain.
   */
  onOpenPaid?: () => void;
  /** What the opened payments add up to, for a statement with nothing billed, whose box has no Paid row of its own. */
  paidMinor?: number;
}) {
  const t = statementTotals(statement);
  const money = (minor: number) => formatMinor(minor, currency);
  const share = (minor: number) => (t.wholeMinor > 0 ? (minor / t.wholeMinor) * 100 : 0);
  const totalLabel = t.closed ? 'Total bill' : 'Upcoming bill';

  return (
    <div data-testid="statement-band">
      <InsetGroup>
        {lead}
        {t.wholeMinor > 0 && (
          <Line>
            <div
              className="flex overflow-hidden bg-[var(--ph-track)]"
              style={{ height: 7, borderRadius: 99 }}
              role="img"
              aria-label={
                t.closed
                  ? `Of ${money(t.billMinor)} billed, ${money(t.paidMinor)} paid and ${money(t.leftMinor)} still to pay`
                  : `${money(t.leftMinor)} still to pay of the ${money(t.billMinor)} previous bill, and ${money(t.unbilledLeftMinor)} unbilled`
              }
            >
              <i style={{ width: `${share(t.paidMinor)}%`, ...HATCH }} />
              <i className="bg-[var(--ph-ink-3)]" style={{ width: `${share(t.leftMinor)}%` }} />
              {!t.closed && (
                <>
                  <i style={{ width: `${share(t.unbilledMinor - t.unbilledLeftMinor)}%`, ...HATCH }} />
                  <i className="bg-[var(--ph-ink)]" style={{ width: `${share(t.unbilledLeftMinor)}%` }} />
                </>
              )}
            </div>
          </Line>
        )}
        {t.wholeMinor === 0 && (
          <Line>
            <span className="text-[15px] leading-[20px] text-[var(--ph-ink-3)]">Nothing billed on this statement.</span>
          </Line>
        )}
        {/* Nothing billed, yet payments went onto the card in its dates (paying ahead): they still open from here. */}
        {t.wholeMinor === 0 && onOpenPaid && <FigureLine label="Paid" owedMinor={paidMinor} ofMinor={null} money={money} faint onOpen={onOpenPaid} />}
        {t.wholeMinor > 0 && t.closed && <FigureLine label="Paid" owedMinor={t.paidMinor} ofMinor={null} money={money} faint onOpen={onOpenPaid} />}
        {t.wholeMinor > 0 && t.closed && <FigureLine label="Still to pay" owedMinor={t.leftMinor} ofMinor={null} money={money} />}
        {t.wholeMinor > 0 && !t.closed && <FigureLine label="Previous bill" owedMinor={t.leftMinor} ofMinor={t.billMinor} money={money} onOpen={onOpenPaid} />}
        {t.wholeMinor > 0 && !t.closed && <FigureLine label="Unbilled" owedMinor={t.unbilledLeftMinor} ofMinor={t.unbilledMinor} money={money} />}
        <FigureLine label={totalLabel} owedMinor={t.totalMinor} ofMinor={null} money={money} strong testId="statement-total" />
      </InsetGroup>
    </div>
  );
}
