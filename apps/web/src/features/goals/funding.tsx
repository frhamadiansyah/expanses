import type { GoalLinkRow } from '@expanses/db';
import type { ReactNode } from 'react';
import { useApp } from '../../app/context';
import { Money } from '../../ui';
import { type GroupChild, InsetRow, type TreePlace } from '../../ui/native';
import { type FundingCurrencyLine, type FundingLine, linkShort } from './funding-lines';

/**
 * What one link is worth, in the money it actually is.
 *
 * `link.valueMinor` is the account's own currency — a US$100,03 set-aside is 10_003 — and this used to be
 * painted under a hardcoded `ws.baseCurrency`, so the chip read `Rp 10.003`. The figure is shown in its own
 * currency, with the base-currency translation beside it when a rate is known and a plain word when it is
 * not. There is one of these because there used to be two, and only one of them would ever have been fixed.
 */
export function LinkAmount({ link, goalCurrency }: { link: GoalLinkRow; goalCurrency?: string }) {
  const { ws } = useApp();
  // The translation is into the goal's own money, which is the base unless the goal has a currency of its own.
  const into = goalCurrency ?? ws.baseCurrency;
  if (link.currency === into) return <Money minor={link.valueMinor} currency={link.currency} />;
  return (
    <>
      <Money minor={link.valueMinor} currency={link.currency} />
      {link.goalMinor === null ? (
        <> · no {into} rate yet</>
      ) : (
        <>
          {' ('}
          <Money minor={link.goalMinor} currency={into} />
          {')'}
        </>
      )}
    </>
  );
}

/** A shortfall said on the row's own line, before its figure: every Funded-by row is one line (owner, 14 Nov). */
function ShortBefore({ link }: { link: GoalLinkRow }) {
  if (!linkShort(link)) return null;
  return (
    <span className="mr-[6px] text-[12.5px]">
      short <Money minor={link.shortMinor} currency={link.currency} />
    </span>
  );
}

/** What funds a goal, as one row of its group, opening that account or holding. Named so the group can hand it its place and a test can name it. */
export function FundingRow({ link, goalCurrency, icon, position }: GroupChild & { link: GoalLinkRow; goalCurrency?: string; icon?: ReactNode }) {
  // Another member's line is read-only here: its account is on their phone, so the row opens nothing.
  const theirs = link.owner !== undefined;
  return (
    <div data-testid="goal-link">
      <InsetRow
        position={position}
        icon={icon}
        title={link.name}
        // One line: whose a line is, the member group's header says; a shortfall is said beside the figure.
        value={
          <>
            <ShortBefore link={link} />
            <LinkAmount link={link} goalCurrency={goalCurrency} />
          </>
        }
        valueTone={linkShort(link) ? 'warn' : 'ink'}
        // The account or holding's own page: a money account's page is reached through the same address.
        to={theirs ? undefined : '/net-worth/assets/$accountId'}
        params={theirs ? undefined : { accountId: link.accountId }}
      />
    </div>
  );
}

/**
 * A multicurrency account on Funded by: one row at what its currencies come to in the goal's money, and a tap opens
 * its currencies under it. The figure is converted, so it wears ≈; any currency short turns it the warning colour.
 */
export function FundingAccountRow({
  line,
  goalCurrency,
  icon,
  open,
  onToggle,
  position,
}: GroupChild & { line: Extract<FundingLine, { type: 'account' }>; goalCurrency: string; icon?: ReactNode; open: boolean; onToggle: () => void }) {
  return (
    <div data-testid="goal-link-account" data-open={open ? 'true' : 'false'}>
      <InsetRow
        position={position}
        icon={icon}
        title={
          <>
            {line.name}
            <span className="sr-only">, {line.children.length} currencies</span>
            <span aria-hidden className="ml-[6px] text-[12px] text-[var(--ph-ink-3)]">
              {open ? '▴' : '▾'}
            </span>
          </>
        }
        // Shut, a short currency is said in words as well as colour, as on every other row; open, its own row says it.
        // A currency with no rate is missing from the sum, so the figure turns warn; with none converting, there is no figure.
        value={
          <>
            {line.short && !open && <span className="text-[12.5px]">short · </span>}
            {line.unconverted === line.children.length ? (
              'No rate yet'
            ) : (
              <>
                {line.approx && '≈ '}
                <Money minor={line.goalMinor} currency={goalCurrency} />
              </>
            )}
          </>
        }
        valueTone={line.short || line.unconverted > 0 ? 'warn' : 'ink'}
        chevron={false}
        onClick={onToggle}
      />
    </div>
  );
}

/** One currency under its open account: the code, and the amount in its own money. Opens that currency as its row always did. */
export function FundingCurrencyRow({ child, tree, position }: GroupChild & { child: FundingCurrencyLine; tree: TreePlace }) {
  const { link } = child;
  return (
    <div data-testid="goal-link-currency">
      <InsetRow
        position={position}
        depth={1}
        tree={tree}
        title={child.code}
        value={
          <>
            <ShortBefore link={link} />
            <Money minor={link.valueMinor} currency={link.currency} />
          </>
        }
        valueTone={child.short ? 'warn' : 'ink'}
        to="/net-worth/assets/$accountId"
        params={{ accountId: link.accountId }}
      />
    </div>
  );
}
