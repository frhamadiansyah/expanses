import { InsetGroup, InsetRow, LargeTitle, SCREEN } from '../../ui/native';
import { CATALOGUE } from './catalogue';

/**
 * The catalogue: what the app can work out, a row each, and each row a page of its own.
 *
 * It used to be one screen of four calculators — about thirty boxes in a single scroll, with the answer of one
 * sitting between the fields of the next, and no way to learn what the page could do without scrolling past it.
 * A row now carries the sentence its calculator would otherwise bury in a footer, so the choice is made on what
 * each one answers; the promise that nothing reaches the books unless it is asked for is said once here, for all
 * four.
 *
 * Nothing computes on this screen, and nothing is kept here: a calculator is its own page, reached with the kit's
 * back button, exactly as it was — the fields, the answer panel and the save row all unchanged.
 */
export function CalculatorsPage() {
  return (
    <div className={SCREEN}>
      <LargeTitle title="Calculators" subtitle="Work out what something costs and what it takes a month. Nothing is saved unless you ask." />
      <InsetGroup footer="Each one works it out only. Nothing reaches your books unless you press the save row on its own page.">
        {CATALOGUE.map((entry) => (
          <InsetRow key={entry.to} to={entry.to} icon={<entry.icon size={16} aria-hidden />} title={entry.label} subtitle={entry.blurb} />
        ))}
      </InsetGroup>
    </div>
  );
}
