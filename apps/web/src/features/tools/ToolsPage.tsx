import { Link, Navigate } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DeskNotices } from '../../app/DeskNotices';
import { useSidebarAccounts } from '../../app/Sidebar';
import type { SidebarAccount } from '../../app/sidebar-model';
import { useEscape } from '../../app/use-escape';
import { usePhone, useSideways } from '../../app/use-phone';
import { cx } from '../../ui';
import { findTools, STATEMENT_CHECK, type ToolGroup, type ToolTile } from './tools-model';
import { CARD, DeskBar, DeskTitle } from '../../ui/desk';

/** A tool's tile: v1's soft card, a round coloured icon, the name, a grey line. */
const TILE = cx(
  CARD,
  'flex h-full w-full flex-col items-start px-[18px] pt-[16px] pb-[16px] text-left hover:bg-[var(--mk-pill)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--mk-blue)]',
);
/** A group's head: small grey capitals, as v1's sidebar and Net worth sections. */
const GROUP_TITLE = 'mb-[10px] px-[4px] text-[11.5px] font-bold tracking-[0.06em] text-[var(--mk-ink-3)] uppercase';

function TileBody({ tile }: { tile: ToolTile }) {
  const Icon = tile.icon;
  return (
    <>
      {/* The tool's own colour (tools-model), on v1's round icon. */}
      <span aria-hidden className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full text-white" style={{ background: tile.tint }}>
        <Icon size={16} strokeWidth={2.2} />
      </span>
      <span className="mt-[12px] text-[14.5px] leading-[19px] font-bold text-[var(--mk-ink)]">{tile.label}</span>
      <span className="mt-[4px] text-[12.5px] leading-[17px] text-[var(--mk-ink-2)]">{tile.line}</span>
    </>
  );
}

/** Statement check asks which account first, as the sidebar's Tools menu did: a small menu under its tile, kept to its right edge (the tile is the row's last, at the window's edge). */
function StatementCheckTile({ tile, accounts }: { tile: ToolTile; accounts: readonly SidebarAccount[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEscape(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const item = 'flex h-[28px] items-center rounded-[8px] px-[10px] text-[13.5px] text-[var(--mk-ink)] hover:bg-[var(--mk-blue)] hover:text-white';
  return (
    <div ref={box} className="relative h-full">
      <button type="button" className={TILE} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="tool-tile">
        <TileBody tile={tile} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Statement check · which account?"
          className="absolute top-full right-0 z-30 mt-[6px] max-h-[320px] min-w-[220px] overflow-y-auto rounded-[12px] bg-[var(--mk-panel)] p-[6px] shadow-[var(--mk-panel-shadow)]"
        >
          <p className="px-[10px] pt-[2px] pb-[4px] text-[11.5px] font-semibold text-[var(--mk-ink-2)]">Which account?</p>
          {accounts.length === 0 && <p className="px-[10px] py-1 text-[12.5px] text-[var(--mk-ink-2)]">No accounts yet.</p>}
          {accounts.map((account) => (
            <Link key={account.id} role="menuitem" to={STATEMENT_CHECK} search={{ account: account.id }} className={item}>
              {account.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Tile({ tile, accounts }: { tile: ToolTile; accounts: readonly SidebarAccount[] }) {
  if (tile.to === null) return <StatementCheckTile tile={tile} accounts={accounts} />;
  return (
    <Link to={tile.to} className={TILE} data-testid="tool-tile">
      <TileBody tile={tile} />
    </Link>
  );
}

function Group({ group, accounts, columns }: { group: ToolGroup; accounts: readonly SidebarAccount[]; columns: number }) {
  return (
    <section aria-label={group.title} className="flex min-w-0 flex-col">
      <h2 className={GROUP_TITLE}>{group.title}</h2>
      {/* Every tile in a row as tall as the tallest, across the groups side by side too. */}
      <div className="grid flex-1 gap-[16px]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {group.tiles.map((tile) => (
          <Tile key={tile.key} tile={tile} accounts={accounts} />
        ))}
      </div>
    </section>
  );
}

/**
 * Tools on a wide screen (Mac Settings and Tools, B): the sidebar's Tools › opens it. A title bar with Find a tool, the
 * calculators in one row, then Cards, Money and Tax & data side by side — each tile straight to the page it names.
 * A phone has no such page: its Account page lists the same places, so the address leads there.
 */
export function ToolsPage() {
  const phone = usePhone();
  const sideways = useSideways();
  const [query, setQuery] = useState('');
  // The account names only (no balances read), for Statement check's question.
  const accounts = useSidebarAccounts(false);
  if (phone || sideways) return <Navigate to="/account" replace />;

  const groups = findTools(query);
  const calculators = groups.find((group) => group.key === 'calculators');
  const rest = groups.filter((group) => group.key !== 'calculators');
  // Each group as wide as its tiles, so every tile in the row is the same width.
  const spans = rest.map((group) => `${group.tiles.length}fr`).join(' ');
  const count = groups.reduce((total, group) => total + group.tiles.length, 0);

  return (
    <div className="min-h-dvh bg-[var(--mk-page)]" data-testid="tools-page" data-desk="true">
      <DeskBar crumb="Tools">
        {/* v1's search: a grey pill in the bar. */}
        <label className="relative flex h-[34px] w-[220px] shrink-0 items-center rounded-full bg-[var(--mk-pill)] text-[13.5px]">
          <Search size={15} aria-hidden className="pointer-events-none absolute left-[13px] text-[var(--mk-ink-2)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                setQuery('');
              }
            }}
            placeholder="Find a tool"
            aria-label="Find a tool"
            autoComplete="off"
            className="h-full w-full rounded-full bg-transparent pr-[14px] pl-[34px] text-[13.5px] text-[var(--mk-ink)] placeholder:text-[var(--mk-ink-2)] focus:outline-2 focus:outline-[var(--mk-blue)]"
          />
        </label>
      </DeskBar>
      <DeskNotices />
      <DeskTitle title="Tools" line={query ? `${count} ${count === 1 ? 'tool' : 'tools'} found` : 'Calculators, cards, money, tax & data'} />

      <div className="space-y-[26px] px-[32px] pt-[2px] pb-[32px]">
        {calculators && <Group group={calculators} accounts={accounts} columns={5} />}
        {rest.length > 0 && (
          <div className="grid gap-[16px]" style={{ gridTemplateColumns: spans }}>
            {rest.map((group) => (
              <Group key={group.key} group={group} accounts={accounts} columns={group.tiles.length} />
            ))}
          </div>
        )}
        {groups.length === 0 && <p className="pt-[8px] text-[14px] text-[var(--mk-ink-2)]">No tool by that name.</p>}
      </div>
    </div>
  );
}
