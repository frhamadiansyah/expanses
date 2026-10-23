import { type CycleBonus, type EarnRule, formatMinor } from '@expanses/core';
import { archiveCycleBonus, archiveEarnRule } from '@expanses/db';
import { getRouteApi } from '@tanstack/react-router';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PanelHeader } from '../../ui/native';
import { BonusForm } from './BonusForm';
import { CardScreen, type CardPage, type Run, useCardAction, useCardPage } from './card-page';
import { activeDuring } from './catalog-panel';
import { CatalogPicker } from './CatalogPicker';
import { ActionRow, RowWithActions, TextLine } from './rows';
import { ruleQualifiers } from './rule-summary';
import { RuleForm } from './RuleForm';
import { useCatalogChoice } from './useCatalogChoice';
import { formatPoints } from './useCardPoints';

const rulesRoute = getRouteApi('/cards/$cardId/settings/rules');
const bonusesRoute = getRouteApi('/cards/$cardId/settings/bonuses');

/** A card without a program has no rules to hold yet: the way to set one up, on the card product page. */
function NoProgram({ page }: { page: CardPage }) {
  return (
    <InsetGroup footer="Rules belong to the card's rewards program, set up from the catalogue or by hand.">
      <InsetRow title="Set up rewards" to="/cards/$cardId/settings/product" params={{ cardId: page.card.id }} />
    </InsetGroup>
  );
}

/**
 * The card's earn rules: each one opening its form where it stands, removed from its glyph, a new one under the
 * list, and the catalogue a tap away for a card set up by hand. Setup's third step draws the same list.
 */
export function EarnRulesEditor({ page, run }: { page: CardPage; run: Run }) {
  const { database, ws } = useApp();
  const { cp, all, currency, today, isDebit } = page;
  const [editingRule, setEditingRule] = useState<EarnRule | 'new' | null>(null);
  const [browsingCatalog, setBrowsingCatalog] = useState(false);
  const { catalogId, chooseEntry, applyEntry, confirmCustomise, canUseCatalog } = useCatalogChoice(page, run, { onApplied: () => setBrowsingCatalog(false) });
  if (!cp.program) return null;
  const sorted = [...cp.rules].sort((a, b) => b.priority - a.priority);
  const row = (rule: EarnRule) => (
    <RowWithActions
      key={rule.id}
      label={`Edit ${rule.name}`}
      onClick={() => setEditingRule(rule)}
      title={
        <>
          {rule.name}
          {rule.stackable && <span className="font-normal text-[var(--ph-ink-3)]"> (stacks)</span>}
        </>
      }
      subtitle={
        <>
          {formatPoints(rule.rateNum)} per {formatMinor(rule.rateDen, currency)} · priority {rule.priority}
          {rule.validFrom && ` · from ${rule.validFrom}`}
          {rule.validTo && ` · until ${rule.validTo}`}
          {rule.capSpendMinor !== null && ` · cap ${formatMinor(rule.capSpendMinor, currency)}/cycle`}
          {(() => {
            const parts = ruleQualifiers(rule, (id) => all.find((a) => a.id === id)?.name ?? '?', (minor) => formatMinor(minor, currency));
            return parts.length ? parts.map((part) => ` · ${part}`).join('') : ' · all categories';
          })()}
        </>
      }
      actions={[
        {
          label: `Remove ${rule.name}`,
          glyph: <Trash2 size={17} aria-hidden />,
          destructive: true,
          onClick: () => window.confirm(`Remove rule ${rule.name}?`) && confirmCustomise() && void run(() => archiveEarnRule(database, ws, rule.id)),
        },
      ]}
    />
  );
  /*
   * The rule being edited is replaced where it stands by its form, as it always was: the list splits around it, so
   * the form reads as that rule opened up rather than as a second copy under the list.
   */
  const at = editingRule !== null && editingRule !== 'new' ? sorted.findIndex((rule) => rule.id === editingRule.id) : -1;
  const before = at < 0 ? sorted : sorted.slice(0, at);
  const after = at < 0 ? [] : sorted.slice(at + 1);
  return (
    <>
      {/* A group with no row left in it would be an empty white bar, so only its header stays. */}
      {before.length === 0 && editingRule !== null ? (
        <PanelHeader title="Earn rules" />
      ) : (
        <InsetGroup header="Earn rules">
          {cp.rules.length === 0 && editingRule === null && (
            <TextLine tone="ink-3">Add the card's base earn rate first. The form starts with a typical rate — change it to match the card. Then add bonus rules with a higher priority.</TextLine>
          )}
          {before.map(row)}
          {editingRule === null && canUseCatalog && (
            <ActionRow label={browsingCatalog ? 'Close catalogue' : 'Choose from catalogue'} icon={<BookOpen size={15} aria-hidden />} onClick={() => setBrowsingCatalog(!browsingCatalog)} />
          )}
          {editingRule === null && <ActionRow label="Add rule" icon={<Plus size={16} aria-hidden />} onClick={() => setEditingRule('new')} />}
        </InsetGroup>
      )}
      {at >= 0 && editingRule !== null && editingRule !== 'new' && (
        <RuleForm key={editingRule.id} programId={cp.program.id} currency={currency} accounts={all} initial={editingRule} beforeSave={confirmCustomise} onDone={() => setEditingRule(null)} />
      )}
      {after.length > 0 && <InsetGroup>{after.map(row)}</InsetGroup>}
      {browsingCatalog && canUseCatalog && <CatalogPicker today={today} selectedId={catalogId} onSelect={chooseEntry} onApply={applyEntry} debit={isDebit} />}
      {editingRule === 'new' && (
        <RuleForm programId={cp.program.id} currency={currency} accounts={all} suggestBase={cp.rules.length === 0} beforeSave={confirmCustomise} onDone={() => setEditingRule(null)} />
      )}
    </>
  );
}

/** The card's spend bonuses: a lump for reaching a spend in a cycle, each opening its form where it stands. */
function BonusesEditor({ page, run }: { page: CardPage; run: Run }) {
  const { database, ws } = useApp();
  const { cp, all, currency, today } = page;
  const [editingBonus, setEditingBonus] = useState<CycleBonus | 'new' | null>(null);
  const { confirmCustomise } = useCatalogChoice(page, run);
  const program = cp.program;
  if (!program) return null;
  const row = (bonus: CycleBonus) => (
    <RowWithActions
      key={bonus.id}
      testId={`bonus-${bonus.id}`}
      label={`Edit ${bonus.name}`}
      onClick={() => confirmCustomise() && setEditingBonus(bonus)}
      title={
        <>
          {bonus.name}
          {!activeDuring(bonus, today, today) && <span className="ml-2 text-[12.5px] font-normal text-[var(--ph-ink-3)]">past terms</span>}
        </>
      }
      subtitle={
        <>
          {bonus.tiers.map((tier) => `${formatMinor(tier.minSpendMinor, currency)} → ${formatPoints(tier.bonus)} ${program.unit}`).join(' · ')}
          {bonus.validFrom && ` · from ${bonus.validFrom}`}
          {bonus.validTo && ` · until ${bonus.validTo}`}
        </>
      }
      actions={[
        {
          label: `Remove ${bonus.name}`,
          glyph: <Trash2 size={17} aria-hidden />,
          destructive: true,
          onClick: () => window.confirm(`Remove bonus ${bonus.name}?`) && confirmCustomise() && void run(() => archiveCycleBonus(database, ws, bonus.id)),
        },
      ]}
    />
  );
  // As with rules: the bonus being edited opens where it stands.
  const at = editingBonus !== null && editingBonus !== 'new' ? cp.bonuses.findIndex((bonus) => bonus.id === editingBonus.id) : -1;
  const before = at < 0 ? cp.bonuses : cp.bonuses.slice(0, at);
  const after = at < 0 ? [] : cp.bonuses.slice(at + 1);
  return (
    <>
      {before.length === 0 && editingBonus !== null ? (
        <PanelHeader title="Spend bonuses" />
      ) : (
        <InsetGroup header="Spend bonuses">
          {cp.bonuses.length === 0 && editingBonus === null && <TextLine tone="ink-3">No spend bonuses. Add one for a card that pays a lump for reaching a spend in a cycle.</TextLine>}
          {before.map(row)}
          {editingBonus === null && <ActionRow label="Add bonus" icon={<Plus size={16} aria-hidden />} onClick={() => confirmCustomise() && setEditingBonus('new')} />}
        </InsetGroup>
      )}
      {at >= 0 && editingBonus !== null && editingBonus !== 'new' && (
        <BonusForm key={editingBonus.id} programId={program.id} currency={currency} unit={program.unit} accounts={all} initial={editingBonus} beforeSave={confirmCustomise} onDone={() => setEditingBonus(null)} />
      )}
      {after.length > 0 && <InsetGroup>{after.map(row)}</InsetGroup>}
      {editingBonus === 'new' && <BonusForm programId={program.id} currency={currency} unit={program.unit} accounts={all} beforeSave={confirmCustomise} onDone={() => setEditingBonus(null)} />}
    </>
  );
}

/** `/cards/$cardId/settings/rules`: the card's earn rules, under its Settings. */
export function EarnRulesPage() {
  const { cardId } = rulesRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { error, run } = useCardAction();
  return (
    <CardScreen title="Earning rules" back="Settings" fallback={`/cards/${cardId}/settings`}>
      {gate}
      <ErrorBox error={error} />
      {page && (page.cp.program ? <EarnRulesEditor page={page} run={run} /> : <NoProgram page={page} />)}
    </CardScreen>
  );
}

/** `/cards/$cardId/settings/bonuses`: the card's spend bonuses, under its Settings. */
export function SpendBonusesPage() {
  const { cardId } = bonusesRoute.useParams();
  const { page, gate } = useCardPage(cardId);
  const { error, run } = useCardAction();
  return (
    <CardScreen title="Spend bonuses" back="Settings" fallback={`/cards/${cardId}/settings`}>
      {gate}
      <ErrorBox error={error} />
      {page && (page.cp.program ? <BonusesEditor page={page} run={run} /> : <NoProgram page={page} />)}
    </CardScreen>
  );
}
