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

const TILE =
  'flex h-full w-full flex-col items-start rounded-[10px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[14px] text-left hover:border-[var(--ph-chevron)] focus-visible:outline-2 focus-visible:outline-[var(--mac-accent)]';
const GROUP_TITLE = 'mb-[8px] text-[11px] font-semibold tracking-[0.06em] text-[var(--ph-ink-3)] uppercase';

function TileBody({ tile }: { tile: ToolTile }) {
  const Icon = tile.icon;
  return (
    <>
      <span aria-hidden className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: tile.tint }}>
        <Icon size={18} strokeWidth={1.9} />
      </span>
      <span className="mt-[10px] text-[13.5px] leading-[18px] font-semibold text-[var(--ph-ink)]">{tile.label}</span>
      <span className="mt-[4px] text-[12px] leading-[16px] text-[var(--ph-ink-3)]">{tile.line}</span>
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
  const item = 'flex h-[24px] items-center rounded-[5px] px-[10px] text-[13px] text-[var(--ph-ink)] hover:bg-[var(--mac-accent)] hover:text-white';
  return (
    <div ref={box} className="relative h-full">
      <button type="button" className={TILE} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-testid="tool-tile">
        <TileBody tile={tile} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Statement check · which account?"
          className="absolute top-full right-0 z-30 mt-1 max-h-[320px] min-w-[220px] overflow-y-auto rounded-[9px] border border-[var(--ph-hair)] bg-[var(--ph-surface)] p-[6px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
        >
          <p className="px-[10px] pt-[2px] pb-[2px] text-[11px] font-semibold text-[var(--ph-ink-3)]">Which account?</p>
          {accounts.length === 0 && <p className="px-[10px] py-1 text-[12px] text-[var(--ph-ink-3)]">No accounts yet.</p>}
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
      <div className="grid flex-1 gap-[12px]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
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

  return (
    <div className="min-h-dvh bg-[var(--ov-ground)]" data-testid="tools-page" data-desk="true">
      <header className="sticky top-0 z-10 flex h-[52px] items-center gap-[10px] border-b border-[var(--ph-hair)] bg-[var(--ph-surface)] pr-[14px] pl-[18px]">
        <h1 className="text-[15px] font-semibold text-[var(--ph-ink)]">Tools</h1>
        <span className="flex-1" />
        <label className="relative flex h-[26px] w-[180px] shrink-0 items-center rounded-[7px] bg-[var(--ph-fill)] text-[12px]">
          <Search size={13} aria-hidden className="pointer-events-none absolute left-[8px] text-[var(--ph-ink-3)]" />
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
            className="h-full w-full rounded-[7px] bg-transparent pr-2 pl-[26px] text-[12px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-2 focus:outline-[var(--mac-accent)]"
          />
        </label>
      </header>
      <DeskNotices />

      <div className="space-y-[22px] px-[20px] py-[18px]">
        {calculators && <Group group={calculators} accounts={accounts} columns={5} />}
        {rest.length > 0 && (
          <div className="grid gap-[16px]" style={{ gridTemplateColumns: spans }}>
            {rest.map((group) => (
              <Group key={group.key} group={group} accounts={accounts} columns={group.tiles.length} />
            ))}
          </div>
        )}
        {groups.length === 0 && <p className="pt-[8px] text-[13px] text-[var(--ph-ink-3)]">No tool by that name.</p>}
      </div>
    </div>
  );
}
