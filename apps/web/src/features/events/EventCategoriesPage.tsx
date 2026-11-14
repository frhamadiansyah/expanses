import { eventCategoryIcon } from '@expanses/core';
import { archiveEventCategory, ownerScope, saveEventCategory, type SharedEventView } from '@expanses/db';
import { useParams } from '@tanstack/react-router';
import { CircleEllipsis, Plus } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN, TextRow } from '../../ui/native';
import { ICONS } from '../categories/CategoryIcon';
import { IconPicker } from '../categories/CategoryLookSheets';
import { sayError } from '../sharing/sharing-copy';
import { chartColour } from '../transactions/category-colours';
import { useSharedEventView } from './shared-queries';
import { pageLocks } from './shared-view';

type Category = SharedEventView['categories'][number];

/**
 * A shared event's categories (shared events §6): each with its icon, renamed or re-iconed from a sheet, archived from
 * the same sheet, and a new one added at the foot. The list is the event's own — what its people file spending under —
 * never the workspace's tree. Done, or an event this phone's person is no longer in, keeps it to read: no sheet opens.
 */
export function EventCategoriesPage() {
  const { eventId } = useParams({ from: '/events/$eventId/categories' });
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const read = useSharedEventView(eventId);
  const view = read.data;
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (!view) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Categories" back="Events" backTo="/events" />
        <ErrorBox error={read.error} />
        {read.isPending || read.error ? null : <p className="px-[4px] py-[8px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]">This event is not shared on this phone.</p>}
      </div>
    );
  }
  const { locked } = pageLocks(view);
  const open = view.categories.filter((c) => !c.archived);

  async function run(work: () => Promise<unknown>) {
    setError(null);
    try {
      await work();
      await invalidate();
      setEditing(null);
    } catch (failure) {
      setError(sayError(failure));
    }
  }

  return (
    <div className={SCREEN} data-testid="event-categories">
      <PushedTitle title="Categories" back="Settings" backTo="/events/$eventId/shared-settings" backParams={{ eventId }} />
      <ErrorBox error={editing ? null : error} />
      <InsetGroup>
        {open.map((c) => {
          const Glyph = (c.icon ? ICONS[c.icon] : undefined) ?? CircleEllipsis;
          return (
            <InsetRow
              key={c.categoryId}
              icon={<Glyph size={16} strokeWidth={2.2} aria-hidden />}
              iconColour={chartColour(c.categoryId)}
              title={c.name}
              onClick={locked ? undefined : () => setEditing(c)}
              label={c.name}
              testId="event-category"
            />
          );
        })}
      </InsetGroup>
      {locked ? null : (
        <InsetGroup>
          <InsetRow icon={<Plus size={16} strokeWidth={2.2} aria-hidden />} iconColour="var(--ph-tint)" title="Add a category" onClick={() => setEditing('new')} testId="event-category-add" />
        </InsetGroup>
      )}
      {editing && !locked ? (
        <CategorySheet
          category={editing === 'new' ? null : editing}
          error={error}
          onClose={() => {
            setError(null);
            setEditing(null);
          }}
          onSave={(name, icon) => void run(() => saveEventCategory(database, ownerScope(ws), eventId, { ...(editing === 'new' ? {} : { id: editing.categoryId }), name, icon }))}
          onArchive={editing === 'new' ? null : () => void run(() => archiveEventCategory(database, ownerScope(ws), eventId, editing.categoryId))}
        />
      ) : null}
    </div>
  );
}

/** One category: its name, its icon on the app's icon picker, and Archive. A new one starts on the icon its name suggests until another is picked. */
function CategorySheet({
  category,
  error,
  onClose,
  onSave,
  onArchive,
}: {
  category: Category | null;
  error: unknown;
  onClose: () => void;
  onSave: (name: string, icon: string) => void;
  onArchive: (() => void) | null;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [picked, setPicked] = useState<string | null>(category?.icon ?? null);
  const [armed, setArmed] = useState(false);
  const icon = picked ?? eventCategoryIcon(name);
  const Glyph = ICONS[icon] ?? CircleEllipsis;
  return (
    <Sheet grouped title={category ? 'Category' : 'New category'} onClose={onClose} confirm={{ label: 'Save category', disabled: !name.trim(), run: () => onSave(name, icon) }}>
      <ErrorBox error={error} />
      <InsetGroup>
        <TextRow label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <InsetRow icon={<Glyph size={16} strokeWidth={2.2} aria-hidden />} iconColour="var(--ph-tint)" title="Icon" chevron={false} testId="event-category-icon" />
      </InsetGroup>
      <IconPicker value={icon} onPick={setPicked} />
      {onArchive ? (
        <InsetGroup>
          <InsetRow
            title={armed ? 'Tap again to archive' : 'Archive'}
            destructive
            testId="event-category-archive"
            onClick={() => {
              if (!armed) return setArmed(true);
              onArchive();
            }}
          />
        </InsetGroup>
      ) : null}
    </Sheet>
  );
}
