import { Link, type LinkProps } from '@tanstack/react-router';
import { ChevronLeft, MoreHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useEscape } from '../../app/use-escape';
import { cx } from '../index';
import { backLabel, type CornerAction, planCornerActions, titleSteps } from './title';

/**
 * Primitive 3: the large title, and the corner buttons beside it.
 *
 * 30 px / 600, the back destination named above it, and actions as circular 44 pt buttons — never a dark
 * rectangle, never an underlined text link. The two things the app does today in place of this are exactly the
 * two things this refuses to draw.
 *
 * The weight is the one Cashflow's header has carried since before the kit: one title face across the app, and
 * the screen most looked at is not the exception to it.
 */

/**
 * A circular 44 pt corner button: white, glyph in the ink, and a shadow lifting it off the page. The one shape every
 * screen's actions take.
 *
 * An action that goes somewhere is drawn as a real link rather than a button that navigates, so a desktop keeps
 * its middle-click and its "open in a new tab" — the shape is the same either way, and the reach is not taken
 * away to get it.
 */
export function CornerButton({
  label,
  onClick,
  to,
  params,
  search,
  children,
  destructive = false,
  disabled = false,
  pressed,
  expanded,
  className,
}: {
  label: string;
  onClick?: () => void;
  to?: LinkProps['to'];
  params?: LinkProps['params'];
  search?: LinkProps['search'];
  children: ReactNode;
  destructive?: boolean;
  /** An action that cannot work yet says so by being dimmed and refusing the tap, rather than by explaining after. */
  disabled?: boolean;
  /** A switch that is on: filled with the ink, as the segmented control's chosen segment is its track's opposite. */
  pressed?: boolean;
  /** The action opens something, and says whether it is open. */
  expanded?: boolean;
  className?: string;
}) {
  const shell = cx(
    'ph-focus flex shrink-0 items-center justify-center rounded-full shadow-[var(--ph-lift)]',
    pressed ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : destructive ? 'bg-[var(--ph-corner)] text-[var(--ph-alarm)]' : 'bg-[var(--ph-corner)] text-[var(--ph-ink)]',
    disabled && 'opacity-40',
    className,
  );
  if (to && !disabled) {
    return (
      <Link to={to} params={params} search={search} aria-label={label} className={shell} style={{ width: 44, height: 44 }}>
        {children}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={pressed} aria-expanded={expanded} aria-label={label} className={shell} style={{ width: 44, height: 44 }}>
      {children}
    </button>
  );
}

/**
 * The `…` and what hides behind it.
 *
 * Escape goes through the app's own `useEscape` stack, which answers the innermost thing open and nothing
 * else — so a menu opened over a sheet closes the menu and leaves the sheet, and no second `document`
 * listener is added to argue about it.
 */
export function OverflowMenu({ actions }: { actions: CornerAction[] }) {
  const [open, setOpen] = useState(false);
  useEscape(() => setOpen(false), open);
  return (
    <span className="relative">
      <CornerButton label="More" onClick={() => setOpen((was) => !was)}>
        <MoreHorizontal size={20} aria-hidden />
      </CornerButton>
      {open && (
        <>
          {/* A tap anywhere else puts the menu away, the way a tap outside a sheet does. */}
          <span className="fixed inset-0 z-10" onClick={() => setOpen(false)} role="presentation" />
          <span
            role="menu"
            aria-label="More"
            className="absolute right-0 z-20 mt-[6px] block min-w-[180px] overflow-hidden bg-[var(--ph-surface)] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.35)]"
            style={{ borderRadius: 11 }}
          >
            {actions.map((action, index) => {
              const item = cx(
                'ph-focus-inset block w-full px-[13px] py-[11px] text-left text-[15px] leading-[20px]',
                index > 0 && 'border-t-[0.5px] border-[var(--ph-hair)]',
                action.destructive ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]',
              );
              // An action that is a journey stays a link behind the `…` too, for the same reason it does in the corner.
              return action.to ? (
                <Link
                  key={action.key}
                  role="menuitem"
                  to={action.to}
                  params={action.params}
                  search={action.search}
                  onClick={() => setOpen(false)}
                  className={item}
                >
                  {action.label}
                </Link>
              ) : (
                <button
                  key={action.key}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    action.run?.();
                  }}
                  className={item}
                >
                  {action.label}
                </button>
              );
            })}
          </span>
        </>
      )}
    </span>
  );
}

/**
 * A screen's title block: where back goes, the title, and at most two corner buttons.
 *
 * On a wide screen the title steps down — 30 px is a phone's answer to having no room for chrome, and a 1440 px
 * window has room, so the desktop gets a title that sits in a header rather than one that is the header.
 */
export function LargeTitle({
  title,
  back,
  onBack,
  backTo,
  backParams,
  backSearch,
  actions = [],
  max,
  subtitle,
  oneLine = false,
}: {
  title: string;
  /** What back goes to, named: `‹ All cards`. A screen reached from two places cannot just say "Back". */
  back?: string;
  onBack?: () => void;
  /** Where back goes. Given a route it is drawn as a link, so the way out can be opened in a tab of its own. */
  backTo?: LinkProps['to'];
  backParams?: LinkProps['params'];
  backSearch?: LinkProps['search'];
  actions?: CornerAction[];
  /** How many corners this screen has. A wide screen has more; the phone has two. */
  max?: number;
  subtitle?: ReactNode;
  /**
   * A title that is a name someone typed, kept to one line: a long one steps down a size (`titleSteps`), and one
   * longer still ends in an ellipsis with the whole name as its tooltip, rather than breaking over two lines.
   */
  oneLine?: boolean;
}) {
  const plan = planCornerActions(actions, max);
  const steps = oneLine && titleSteps(title);
  /*
   * The way back is a control a thumb has to find, so it is 44 tall like every other — and drawn as though it were
   * not: the negative margins give the hit area back to the layout, so the line still sits where 28px put it.
   */
  /*
   * The way back is drawn in the page's own ink, not the tint: it is chrome, not an action, and a column of green
   * back links down the phone's history read as an accent shouting on every screen. The tint stays where it says
   * something — a selection, progress, the receipt for something saved.
   */
  const backShell =
    'ph-focus -mt-[8px] -mb-[6px] -ml-[2px] inline-flex min-h-[44px] items-center rounded px-[2px] text-[14px] leading-[18px] text-[var(--ph-ink)]';
  return (
    <header className="mb-[14px] md:max-w-4xl">
      {back &&
        (backTo ? (
          <Link to={backTo} params={backParams} search={backSearch} aria-label={back} className={backShell}>
            {backLabel(back)}
          </Link>
        ) : (
          <button type="button" onClick={onBack} className={backShell}>
            {backLabel(back)}
          </button>
        ))}
      <div className="flex items-start justify-between gap-3" style={{ paddingTop: 8 }}>
        <div className="min-w-0 flex-1">
          <h1
            title={oneLine ? title : undefined}
            className={cx(
              // Semibold, the weight Cashflow's title has always carried: a page's name is not a figure, and the
              // screen whose title people see most should not be the only one that draws it this way.
              'font-semibold tracking-tight text-[var(--ph-ink)] md:text-[24px] md:leading-[30px]',
              steps ? 'text-[22px] leading-[36px]' : 'text-[30px] leading-[36px]',
              oneLine && 'truncate',
            )}
          >
            {title}
          </h1>
          {subtitle && <p className="mt-[2px] text-[13px] leading-[17px] text-[var(--ph-ink-3)]">{subtitle}</p>}
        </div>
        {(plan.inline.length > 0 || plan.overflow.length > 0) && (
          <div className="flex shrink-0 items-center gap-[8px]">
            {plan.inline.map((action) => (
              <CornerButton
                key={action.key}
                label={action.label}
                to={action.to}
                params={action.params}
                search={action.search}
                onClick={action.to ? undefined : () => action.run?.()}
                destructive={action.destructive}
                disabled={action.disabled}
                pressed={action.pressed}
                expanded={action.expanded}
              >
                {action.glyph}
              </CornerButton>
            ))}
            {plan.overflow.length > 0 && <OverflowMenu actions={plan.overflow} />}
          </div>
        )}
      </div>
    </header>
  );
}

/**
 * A pushed screen's title: the way back in the corner's own circle, and the name centred between.
 *
 * A screen reached from a section draws the bar iOS draws for a pushed screen — a chevron in a circle at the top
 * left, the page's name in the middle — rather than `LargeTitle`'s name large in the page's own ink with the
 * destination named in a line above it. Which of the two a screen gets is not a matter of taste: a section of the
 * app is a top level, and a subpage is something you came into from one.
 *
 * The name is centred in the *screen*, not in whatever the buttons leave: the two outer columns are equal, so two
 * corner buttons move it no more than none does.
 */
export function PushedTitle({
  title,
  back,
  onBack,
  backTo,
  backParams,
  backSearch,
  actions = [],
  max,
}: {
  title: string;
  /** Where the way back goes, and what a screen reader hears — `Cashflow`, never "Back". */
  back: string;
  /** What back does, when it is not a journey: a sheet closing, a step going back. */
  onBack?: () => void;
  /** Where back goes. Given a route it is a link, so the circle keeps its middle-click and its new tab. */
  backTo?: LinkProps['to'];
  backParams?: LinkProps['params'];
  backSearch?: LinkProps['search'];
  actions?: CornerAction[];
  /** How many corners this screen has. A wide screen has more; the phone has two. */
  max?: number;
}) {
  const plan = planCornerActions(actions, max);
  return (
    <header className="mb-[14px] md:max-w-4xl">
      <div className="flex items-center gap-[8px]">
        <div className="flex flex-1 items-center">
          <CornerButton label={back} to={backTo} params={backParams} search={backSearch} onClick={backTo ? undefined : onBack}>
            <ChevronLeft size={22} aria-hidden />
          </CornerButton>
        </div>
        {/* A name that does not fit steps down to an ellipsis rather than wrapping: the bar is one line tall. */}
        <h1 className="min-w-0 truncate text-center text-[22px] font-semibold leading-[28px] tracking-tight text-[var(--ph-ink)]">
          {title}
        </h1>
        <div className="flex flex-1 items-center justify-end gap-[8px]">
          {plan.inline.map((action) => (
            <CornerButton
              key={action.key}
              label={action.label}
              to={action.to}
              params={action.params}
              search={action.search}
              onClick={action.to ? undefined : () => action.run?.()}
              destructive={action.destructive}
              disabled={action.disabled}
              pressed={action.pressed}
              expanded={action.expanded}
            >
              {action.glyph}
            </CornerButton>
          ))}
          {plan.overflow.length > 0 && <OverflowMenu actions={plan.overflow} />}
        </div>
      </div>
    </header>
  );
}
