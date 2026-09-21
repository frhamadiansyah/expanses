import { formatMinor } from '@expanses/core';
import type { CardStatement } from '@expanses/db';
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
}: GroupChild & { label: string; owedMinor: number; ofMinor: number | null; money: (minor: number) => string; faint?: boolean; strong?: boolean; testId?: string }) {
  return (
    <Line position={position} testId={testId} className="flex items-baseline justify-between gap-3">
      <span className={cx('text-[15px] leading-[20px]', strong ? 'font-semibold text-[var(--ph-ink)]' : 'text-[var(--ph-ink)]')}>{label}</span>
      <span className={cx('tabular text-right text-[15px] leading-[20px] whitespace-nowrap', strong && 'font-semibold', faint ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>
        {money(owedMinor)}
        {ofMinor !== null && ofMinor !== owedMinor && <span className="font-normal text-[var(--ph-ink-3)]"> of {money(ofMinor)}</span>}
      </span>
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
export function StatementBand({ statement, currency }: { statement: CardStatement; currency: string }) {
  const t = statementTotals(statement);
  const money = (minor: number) => formatMinor(minor, currency);
  const share = (minor: number) => (t.wholeMinor > 0 ? (minor / t.wholeMinor) * 100 : 0);
  const totalLabel = t.closed ? 'Total bill' : 'Upcoming bill';

  return (
    <div data-testid="statement-band">
      <InsetGroup>
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
        {t.wholeMinor > 0 && t.closed && <FigureLine label="Paid" owedMinor={t.paidMinor} ofMinor={null} money={money} faint />}
        {t.wholeMinor > 0 && t.closed && <FigureLine label="Still to pay" owedMinor={t.leftMinor} ofMinor={null} money={money} />}
        {t.wholeMinor > 0 && !t.closed && <FigureLine label="Previous bill" owedMinor={t.leftMinor} ofMinor={t.billMinor} money={money} />}
        {t.wholeMinor > 0 && !t.closed && <FigureLine label="Unbilled" owedMinor={t.unbilledLeftMinor} ofMinor={t.unbilledMinor} money={money} />}
        <FigureLine label={totalLabel} owedMinor={t.totalMinor} ofMinor={null} money={money} strong testId="statement-total" />
      </InsetGroup>
    </div>
  );
}
