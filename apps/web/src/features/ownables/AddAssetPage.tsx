import { useNavigate, useSearch } from '@tanstack/react-router';
import { useState } from 'react';
import type { FormConfirm } from '../networth/AddAssetForm';
import { AddAssetForm } from '../networth/AddAssetForm';
import { handOverRows } from './catalogue-view';
import { OwnablePicker, type PickerPlace } from './OwnablePicker';

/**
 * Adding an asset, two levels deep: the family, then the thing — and "Something else" at the foot of a family for
 * the rest of that table, so nothing a person owns is unreachable because the five families did not name it.
 *
 * The row at the foot is what keeps money out of here: most people's first instinct is that a bank balance is an
 * asset, and it is — but one the Accounts page keeps, where it can be spent from.
 */
export function AddAssetPage() {
  const navigate = useNavigate();
  const start = useSearch({ from: '/net-worth/assets/new' });
  const [chosen, setChosen] = useState<string | null>(null);
  // The form says when it can save and how; the bar draws it as ✓.
  const [confirm, setConfirm] = useState<FormConfirm | null>(null);
  async function leaveFor(at: PickerPlace | undefined) {
    await navigate({ to: '/net-worth/assets/new', search: at ?? {}, replace: true });
    await navigate({ to: '/net-worth/investments/new' });
  }
  return (
    <OwnablePicker
      flow="asset"
      title="New asset"
      searchPlaceholder="Search everything that can be owned"
      moreHint={(family) => `Anything here is recorded as a thing given a value, and files under ${family.toLowerCase()} in the tax report.`}
      chosen={chosen}
      // Listed shares start from a ticker (spec §7.5); everything else opens the form here, as before.
      // The list's place goes into this entry first, so Back from Add a holding opens the list where it was left.
      onChoose={(id, at) => (id === 'stock' ? void leaveFor(at) : setChosen(id))}
      start={start}
      handOver={handOverRows('asset')}
      confirm={confirm ? { label: 'Add asset', ...confirm } : undefined}
    >
      {/* The picker lays its whole screen on the kit's ground, so the form's groups sit on it as they are. */}
      {chosen && <AddAssetForm key={chosen} itemId={chosen} onDone={() => void navigate({ to: '/net-worth/assets' })} onConfirm={setConfirm} />}
    </OwnablePicker>
  );
}
