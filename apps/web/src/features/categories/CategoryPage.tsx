import { type CategoryNeed, categoryVisual, mccName, needOf, type ResolvedNeed } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Archive, CircleHelp, Info, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAccounts, useCategoryColours, useInOpenBook } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { type GroupChild, InsetGroup, InsetRow, PushedTitle, ROW_PAD_X, ROW_PAD_Y, SCREEN, TAP } from '../../ui/native';
import { categoryMcc } from './category-mcc';
import { mccCaption, needCaption } from './category-details';
import { CategoryIcon, categoryKeys, categoryMark, ICONS } from './CategoryIcon';
import { ColourSheet, IconSheet, ParentSheet } from './CategoryLookSheets';
import { useCategoryMccs, useCategoryUsage } from './mcc-queries';
import { useCategoryNeeds } from './need-queries';
import { useCategorySetMembership, useCategorySets } from './set-queries';
import { useCategoryActions } from './use-category-actions';

const NEED_EXPLAINED =
  'Essential or lifestyle decides what an emergency fund covers and how the Budget splits what you spent. A category with no mark follows its parent, and counts as essential at the top.';

/**
 * "Counts as", answered by the native pop-up menu: the answer is always one of two, and the row shows which even when
 * it is inherited. Choosing either makes the mark the category's own.
 */
function NeedRow({ name, need, caption, onChoose, position }: GroupChild & { name: string; need: ResolvedNeed; caption?: string; onChoose: (need: CategoryNeed) => void }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: TAP, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-[6px]">
            <span className="text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">Counts as</span>
            {/* The why of the answer, the way a form row's ⓘ opens its own: under the row, until tapped again. */}
            <button
              type="button"
              aria-label="About Counts as"
              aria-expanded={explained}
              onClick={() => setExplained((was) => !was)}
              className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
            >
              <Info size={16} aria-hidden />
            </button>
          </span>
          {caption && (
            <span data-testid="need-source" className="mt-[2px] block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              {caption}
            </span>
          )}
        </span>
        {/* The answer and ›, drawn as every other row's, over a real select so the phone opens its own native menu. */}
        <span className="ph-focus-within relative flex shrink-0 items-center gap-[4px] text-[16px] leading-[20px] text-[var(--ph-ink-2)] md:text-[15px]">
          <span aria-hidden>{need.need === 'lifestyle' ? 'Lifestyle' : 'Essential'}</span>
          <span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>
          <select
            aria-label={`What ${name} counts as`}
            value={need.need}
            onChange={(e) => {
              const key = e.target.value as CategoryNeed;
              if (key !== need.need || need.source !== 'yours') onChoose(key);
            }}
            className="absolute inset-0 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          >
            <option value="essential">Essential</option>
            <option value="lifestyle">Lifestyle</option>
          </select>
        </span>
      </div>
      {explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{NEED_EXPLAINED}</p>}
    </div>
  );
}

/**
 * "Merchant category code": the code on the row, and what it means — too long for a line under the title — behind an
 * ⓘ beside the title, opening under the row the way Counts as explains itself. The code and › are the way to change it.
 */
function MccRow({ name, code, about, onChange, position }: GroupChild & { name: string; code: string | null; about?: string; onChange: () => void }) {
  const [explained, setExplained] = useState(false);
  return (
    <div className="relative" data-testid="category-mcc">
      {position?.separator && <span aria-hidden className="pointer-events-none absolute top-0 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X, right: ROW_PAD_X }} />}
      <div className="flex items-center gap-3" style={{ minHeight: TAP, padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}>
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <span className="min-w-0 truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">Merchant category code</span>
          {about && (
            <button
              type="button"
              aria-label="About Merchant category code"
              aria-expanded={explained}
              onClick={() => setExplained((was) => !was)}
              className="ph-focus ph-tap flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[var(--ph-ink-3)]"
            >
              <Info size={16} aria-hidden />
            </button>
          )}
        </span>
        <button
          type="button"
          aria-label={`Merchant category code for ${name}`}
          onClick={onChange}
          className="ph-focus flex shrink-0 items-center gap-[6px] text-[16px] leading-[20px] text-[var(--ph-ink-2)] md:text-[15px]"
        >
          <span className="tabular">{code ?? 'None'}</span>
          <span aria-hidden className="text-[17px] leading-none text-[var(--ph-chevron)]">{'›'}</span>
        </button>
      </div>
      {about && explained && <p className="px-[13px] pb-[8px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{about}</p>}
    </div>
  );
}

/**
 * A category's own page: its icon and name, then every change that used to crowd its line on the list — the name,
 * what it counts as, its card MCC, the subcategories under it — and archiving, behind ⋯.
 */
export function CategoryPage() {
  const { categoryId } = useParams({ from: '/categories/$categoryId' });
  const navigate = useNavigate();
  const accounts = useAccounts();
  const all = accounts.data ?? [];
  const inOpenBook = useInOpenBook();
  const membership = useCategorySetMembership().data ?? {};
  const sets = useCategorySets().data ?? [];
  const overrides = useCategoryMccs().data ?? {};
  const needs = useCategoryNeeds().data ?? {};
  const actions = useCategoryActions();
  const chosen = useCategoryColours().data ?? {};
  const [sheet, setSheet] = useState<'icon' | 'colour' | 'parent' | null>(null);

  const category = all.find((a) => a.id === categoryId && a.archivedAt === null);
  const usage = useCategoryUsage(categoryId, category !== undefined);
  const set = sets.find((s) => s.id === membership[categoryId]);
  const inSet = membership[categoryId] !== undefined;
  const back = inSet
    ? ({ back: 'Sets', backTo: '/categories/sets' } as const)
    : ({ back: 'Categories', backTo: '/categories', backSearch: category?.kind === 'income' ? { kind: 'income' as const } : {} } as const);

  if (!category) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Category" {...back} />
        {accounts.isSuccess && <Empty>This category is not here any more.</Empty>}
      </div>
    );
  }

  const c: AccountRow = category;
  const parent = c.parentId ? all.find((a) => a.id === c.parentId) : undefined;
  const allCategories = all.filter((a) => a.subtype === 'category');
  const expense = c.kind === 'expense';
  const card = expense ? categoryMcc(c, allCategories, overrides) : null;
  const need = expense && !inSet ? needOf(c.id, allCategories, needs) : null;
  const children = !c.parentId && !inSet ? all.filter((a) => a.parentId === c.id && a.archivedAt === null && membership[a.id] === undefined && inOpenBook(a)) : [];

  // What the category draws when nothing is picked for it: its default by key, or its parent's.
  const { key, rootKey } = categoryKeys(c.id, all);
  const automatic = categoryVisual(key, rootKey);
  const mark = categoryMark(c.id, all, chosen);
  const top = !c.parentId && !inSet;
  const ownColour = top ? (chosen[c.id] ?? null) : null;
  const parents = inSet
    ? []
    : all.filter(
        (a) =>
          a.subtype === 'category' && a.kind === c.kind && a.parentId === null && a.archivedAt === null && a.id !== c.id && membership[a.id] === undefined && inOpenBook(a),
      );
  const hasChildren = all.some((a) => a.parentId === c.id && a.archivedAt === null);
  // Closed whether or not it saved: a refusal is written on the page, under where the sheet was.
  const saved = (done: Promise<boolean>) => void done.then(() => setSheet(null));

  const leave = () => navigate(inSet ? { to: '/categories/sets' } : { to: '/categories', search: c.kind === 'income' ? { kind: 'income' } : {} });
  const archive = async () => {
    if (await actions.archive(c)) await leave();
  };
  const remove = async () => {
    if (await actions.remove(c)) await leave();
  };
  // Delete only for a category nothing uses, and never a built-in one (it would come back on the next start).
  const deletable = usage.data?.canDelete === true;

  return (
    <div className={SCREEN}>
      <PushedTitle
        title={c.parentId ? 'Subcategory' : 'Category'}
        {...back}
        actions={[
          {
            key: 'more',
            label: 'More',
            glyph: <MoreHorizontal size={20} aria-hidden />,
            // Neither line is drawn red: ink with the grey glyph, like the other ⋯ lines. Delete still asks first.
            menu: [
              { key: 'archive', label: 'Archive category', glyph: <Archive size={17} aria-hidden />, run: () => void archive() },
              ...(deletable ? [{ key: 'delete', label: 'Delete category', glyph: <Trash2 size={17} aria-hidden />, run: () => void remove() }] : []),
            ],
          },
        ]}
      />
      <ErrorBox error={actions.error} />

      <section className="flex flex-col items-center gap-1 pb-[18px] text-center md:max-w-2xl" data-testid="category-hero">
        <CategoryIcon categoryId={c.id} accounts={all} size="lg" />
        <h2 className="mt-2 text-[22px] leading-[28px] font-semibold tracking-tight text-[var(--ph-ink)]">{c.name}</h2>
        {parent && <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">in {parent.name}</p>}
        {set && <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">in the {set.name} set</p>}
      </section>

      <InsetGroup>
        <InsetRow title="Name" value={c.name} label={`Rename ${c.name}`} onClick={() => actions.rename(c)} />
        <InsetRow
          title="Icon"
          value={<mark.Glyph size={18} strokeWidth={2.2} aria-hidden className="inline-block align-middle text-[var(--ph-ink-2)]" />}
          label={`Icon for ${c.name}`}
          testId="category-icon-row"
          onClick={() => setSheet('icon')}
        />
        {top && (
          <InsetRow
            title="Colour"
            value={
              <span data-testid="category-colour-swatch" data-colour={mark.colour} aria-hidden className="inline-block h-[18px] w-[18px] rounded-full align-middle" style={{ background: mark.colour }} />
            }
            label={`Colour for ${c.name}`}
            onClick={() => setSheet('colour')}
          />
        )}
        {set ? (
          <InsetRow title="Set" value={set.name} to="/categories/sets" />
        ) : (
          <InsetRow title="Parent" value={parent?.name ?? 'None'} label={`Parent of ${c.name}`} testId="category-parent-row" onClick={() => setSheet('parent')} />
        )}
      </InsetGroup>

      {sheet === 'icon' && (
        <IconSheet
          current={c.icon}
          automatic={ICONS[automatic.icon] ?? CircleHelp}
          onSave={(icon) => (icon === c.icon ? setSheet(null) : saved(actions.setIcon(c, icon)))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'colour' && top && (
        <ColourSheet
          current={ownColour}
          automatic={automatic.colour}
          onSave={(colour) => (colour === ownColour ? setSheet(null) : saved(actions.setColour(c, colour)))}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'parent' && !inSet && (
        <ParentSheet
          current={c.parentId}
          parents={parents}
          blocked={hasChildren}
          onSave={(parentId) => (parentId === c.parentId ? setSheet(null) : saved(actions.move(c, parentId)))}
          onClose={() => setSheet(null)}
        />
      )}

      {card && (
        <InsetGroup>
          {need && (
            <NeedRow name={c.name} need={need} caption={needCaption(need.source, parent?.name ?? null)} onChoose={(chosen) => actions.markNeed(c, chosen)} />
          )}
          {need?.source === 'yours' && (
            <InsetRow title={parent ? 'Follow parent' : 'Clear mark'} label={`Clear the mark on ${c.name}`} chevron={false} onClick={() => actions.clearNeed(c)} />
          )}
          <MccRow
            name={c.name}
            code={card.mcc}
            about={mccCaption(card, card.mcc ? mccName(card.mcc) : null, parent?.name ?? null)}
            onChange={() => actions.changeMcc(c, card.mcc)}
          />
          {card.source === 'yours' && <InsetRow title="Reset merchant category code" label={`Reset merchant category code for ${c.name}`} chevron={false} onClick={() => actions.resetMcc(c)} />}
        </InsetGroup>
      )}

      {!c.parentId && !inSet && (
        <InsetGroup header="Subcategories">
          {children.map((child) => {
            const { Glyph, colour } = categoryMark(child.id, all, chosen);
            return (
              <InsetRow
                key={child.id}
                icon={<Glyph size={15} strokeWidth={2.2} />}
                iconColour={colour}
                title={child.name}
                to="/categories/$categoryId"
                params={{ categoryId: child.id }}
              />
            );
          })}
          <InsetRow icon={<Plus size={16} aria-hidden />} title="Add subcategory" chevron={false} onClick={() => actions.add(c.kind === 'income' ? 'income' : 'expense', c)} />
        </InsetGroup>
      )}
    </div>
  );
}
