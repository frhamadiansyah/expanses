import { CORETAX_SECTIONS, isoDate, missingCoretaxFields } from '@expanses/core';
import { type AssetProfileRow, changeAcquired, renameAccount, saveAssetProfile } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SCREEN, TextRow } from '../../ui/native';
import { useOpenings } from '../accounts/queries';
import { type AcquiredParts, partsOf } from './acquired';
import { AcquiredRow } from './AssetRows';
import { errorHint } from './AssetSettings';
import { type AssetEditStart, editProblems, planAssetEdit } from './edit-asset';
import { useAcquiredDates, useAssetProfile, useAssetValues } from './queries';

export function EditAssetRoute() {
  const { accountId } = useParams({ from: '/net-worth/assets/$accountId/edit' });
  return <EditAssetPage accountId={accountId} />;
}

/**
 * An asset's Edit screen, from the ⋯ on its page: its name, when it was acquired, and what the tax report's table asks
 * of it (make and plate for a car, location and area for land). Adding an asset asks none of the tax questions, so
 * they are answered here, once, and every yearly report reuses them. ✓ saves what changed and goes back.
 */
export function EditAssetPage({ accountId }: { accountId: string }) {
  const values = useAssetValues();
  const profile = useAssetProfile(accountId);
  const openings = useOpenings([accountId]);
  const acquiredDates = useAcquiredDates();
  const value = values.data?.find((row) => row.accountId === accountId);
  const ready = !values.isPending && !profile.isPending && !openings.isPending && !acquiredDates.isPending;

  if (!ready) return <div className={SCREEN} />;
  if (!value) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="Edit" back="Assets" backTo="/net-worth/assets" />
        <ErrorBox error={values.error ?? profile.error} />
        <Empty>That asset is not in this workspace.</Empty>
      </div>
    );
  }

  // Something valued by its owner is dated here; a priced holding is dated by its purchases, edited on its own page.
  const snapshot = value.mode === 'snapshot';
  const stored = acquiredDates.data?.[accountId];
  const openedOn = openings.data?.[accountId]?.occurredOn;
  const acquired: AcquiredParts | null = !snapshot
    ? null
    : stored
      ? partsOf(stored.on, stored.precision)
      : openedOn
        ? partsOf(openedOn, 'day')
        : { year: profile.data?.acquiredYear ? String(profile.data.acquiredYear) : '', month: '', day: '' };

  const start: AssetEditStart = {
    name: value.name,
    acquired,
    section: profile.data?.coretaxSection ?? null,
    fields: profile.data?.coretaxFields ?? {},
  };
  return <EditAssetForm key={accountId} accountId={accountId} start={start} profile={profile.data ?? null} />;
}

function EditAssetForm({ accountId, start, profile }: { accountId: string; start: AssetEditStart; profile: AssetProfileRow | null }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const [typed, setTyped] = useState<AssetEditStart>(start);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const back = () => navigate({ to: '/net-worth/assets/$accountId', params: { accountId } });
  const section = typed.section;
  const problems = editProblems(section, typed.fields);
  const missing = section ? missingCoretaxFields(section, typed.fields) : [];

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const plan = planAssetEdit(start, typed, isoDate());
      if (plan.rename) await renameAccount(database, ws, accountId, plan.rename);
      if (plan.acquired) await changeAcquired(database, ws, accountId, plan.acquired, isoDate());
      if (plan.fields && profile) {
        // The profile is written whole: everything as it was but the fields, and the year the date may have moved.
        await saveAssetProfile(database, ws, {
          accountId,
          assetKind: profile.assetKind,
          planGroup: profile.planGroup,
          unitKind: profile.unitKind,
          lotSize: profile.lotSize,
          risk: profile.risk,
          coretaxSection: profile.coretaxSection,
          coretaxCode: profile.coretaxCode,
          acquiredYear: plan.acquired ? Number(plan.acquired.on.slice(0, 4)) : profile.acquiredYear,
          reportable: profile.reportable,
          taxTreatment: profile.taxTreatment,
          coretaxFields: plan.fields,
        });
      }
      await invalidate();
      await back();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Edit"
        back={start.name}
        onBack={() => void back()}
        actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, disabled: busy, run: () => void save() }]}
      />
      <InsetGroup>
        <TextRow label="Name" value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.target.value })} />
        {typed.acquired ? <AcquiredRow value={typed.acquired} onChange={(acquired) => setTyped({ ...typed, acquired })} /> : null}
      </InsetGroup>

      {section ? (
        <InsetGroup
          header={`For the tax report: ${CORETAX_SECTIONS[section].label}`}
          trailing={missing.length === 0 ? 'Nothing missing' : `${missing.length} still missing`}
          footer="Filled in once, reused by every yearly report. Any of it can wait."
        >
          {CORETAX_SECTIONS[section].fields.map((field) => {
            const problem = problems.find((item) => item.key === field.key);
            return (
              <TextRow
                key={field.key}
                label={field.label}
                value={typed.fields[field.key] ?? ''}
                onChange={(e) => setTyped({ ...typed, fields: { ...typed.fields, [field.key]: e.target.value } })}
                inputMode={field.kind === 'number' || field.kind === 'npwp' ? 'numeric' : undefined}
                placeholder={field.kind === 'country' ? 'Country code' : 'Not set'}
                hint={problem ? errorHint(problem.message) : undefined}
              />
            );
          })}
        </InsetGroup>
      ) : null}
      <ErrorBox error={error} />
    </div>
  );
}
