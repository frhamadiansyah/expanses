import { Plus } from 'lucide-react';
import { useAccounts } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { categoryMark } from './CategoryIcon';
import { useCategorySetMembership, useCategorySets } from './set-queries';
import { useCategoryActions } from './use-category-actions';

/**
 * The sets: categories an event draws on, kept out of the monthly tree. Each set is a group under its own name, its
 * categories rows that open their own page, and the set's own changes the last rows of the group.
 */
export function SetsPage() {
  const accounts = useAccounts().data ?? [];
  const membership = useCategorySetMembership().data ?? {};
  const sets = useCategorySets();
  const actions = useCategoryActions();

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Sets"
        back="Categories"
        backTo="/categories"
        actions={[{ key: 'add', label: 'Add set', glyph: <Plus size={22} aria-hidden />, run: actions.addSet }]}
      />
      <ErrorBox error={actions.error} />
      <p className="px-[4px] pb-[14px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)] md:max-w-2xl">
        Categories an event draws on, kept out of the monthly list. A set is named once and used by any number of events.
      </p>

      <div data-testid="category-sets">
        {sets.isSuccess && sets.data.length === 0 && <Empty>No sets yet.</Empty>}
        {(sets.data ?? []).map((set) => {
          const inSet = accounts.filter((account) => membership[account.id] === set.id && account.archivedAt === null);
          return (
            <div key={set.id} data-testid={`set-${set.name}`}>
              <InsetGroup header={set.name}>
                {inSet.map((category) => {
                  const { Glyph, colour } = categoryMark(category.id, accounts);
                  return (
                    <InsetRow
                      key={category.id}
                      icon={<Glyph size={15} strokeWidth={2.2} />}
                      iconColour={colour}
                      title={category.name}
                      to="/categories/$categoryId"
                      params={{ categoryId: category.id }}
                    />
                  );
                })}
                <InsetRow
                  icon={<Plus size={16} aria-hidden />}
                  title="Add category"
                  label={`Add a category to ${set.name}`}
                  chevron={false}
                  onClick={() => actions.addToSet(set.id, set.name)}
                />
                <InsetRow title="Rename set" label={`Rename ${set.name}`} chevron={false} onClick={() => actions.renameSet(set.id, set.name)} />
                <InsetRow title="Remove set" label={`Remove ${set.name}`} destructive onClick={() => actions.removeSet(set.id, set.name)} />
              </InsetGroup>
            </div>
          );
        })}
      </div>
    </div>
  );
}
