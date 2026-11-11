import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Pictogram } from '../../ui/pictogram';

/** The notes of the BCEAO, largest first; what is below 500 F is coins. */
const NOTE_VALUES = [10_000, 5_000, 2_000, 1_000, 500] as const;
/** Ten notes of 10 000 F make a bundle, as in the hand. */
const BUNDLE = 100_000;
/** Beyond nine bundles, one bundle and its number. */
const MAX_BUNDLES_DRAWN = 9;

export type BanknoteLayout = {
  readonly bundles: number;
  readonly notes: readonly { readonly value: number; readonly count: number }[];
  /** What is left below the smallest note, in francs. */
  readonly coins: number;
};

/** How an amount sits in the hand (bureau-admin-v2.html, screen 8): bundles of 100 000 F, notes, then coins. */
export function banknotesOf(amount: number): BanknoteLayout {
  if (!Number.isInteger(amount) || amount <= 0) return { bundles: 0, notes: [], coins: 0 };
  const bundles = Math.floor(amount / BUNDLE);
  let rest = amount - bundles * BUNDLE;
  const notes: { value: number; count: number }[] = [];
  for (const value of NOTE_VALUES) {
    const count = Math.floor(rest / value);
    if (count > 0) notes.push({ value, count });
    rest -= count * value;
  }
  return { bundles, notes, coins: rest };
}

const NOTE_TONE: Record<number, string> = { 10_000: 'n10000', 5_000: 'n5000', 2_000: 'n2000', 1_000: 'n1000', 500: 'n500' };
const words = (value: number) => value.toLocaleString('fr-FR');

// The amount laid out in notes, so that it is checked at a glance without reading the figure
// (CdC « Un bureau pour ceux qui ne lisent pas »). Colours to set against the real BCEAO notes,
// without copying them.
@Component({
  selector: 'app-banknotes',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="notes" role="img" [attr.aria-label]="label()">
      @if (layout().bundles > 0) {
        <span class="bundle" [class.many]="layout().bundles > maxBundles">
          <b>100 000</b>
          @if (layout().bundles > maxBundles) {
            <em>× {{ layout().bundles }}</em>
          }
        </span>
        @if (layout().bundles <= maxBundles) {
          @for (_ of bundlesAfterFirst(); track $index) {
            <span class="bundle"><b>100 000</b></span>
          }
        }
      }
      @for (note of layout().notes; track note.value) {
        @for (_ of countOf(note.count); track $index) {
          <span class="note" [class]="'note ' + tone[note.value]">{{ words(note.value) }}</span>
        }
      }
      @if (layout().coins > 0) {
        <span class="coins"><app-pictogram picto="coin" [decorative]="true" /> {{ words(layout().coins) }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .notes { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; justify-content: center; min-block-size: 30px; }
    .note, .bundle b {
      display: inline-grid; place-items: center; min-inline-size: 52px; block-size: 26px; padding: 0 4px;
      border: 2px solid var(--color-ink); border-radius: 3px; font: 700 0.72rem var(--font-hand); color: var(--color-ink);
    }
    .bundle { position: relative; display: inline-flex; align-items: center; gap: 4px; }
    .bundle b { background: var(--color-blue); color: var(--color-on-sign); box-shadow: 2px 2px 0 var(--color-ink), 4px 4px 0 var(--color-ink); }
    .bundle em { font: 700 1rem var(--font-hand); font-style: normal; color: var(--color-earth); }
    .n10000 { background: var(--color-blue); color: var(--color-on-sign); }
    .n5000 { background: var(--color-pasture-light); }
    .n2000 { background: var(--color-orange-light); }
    .n1000 { background: var(--color-straw); }
    .n500 { background: var(--color-kraft); }
    .coins { display: inline-flex; align-items: center; gap: 3px; font: 700 0.85rem var(--font-hand); color: var(--color-earth); }
    .coins app-pictogram { inline-size: 22px; block-size: 22px; }
  `,
})
export class Banknotes {
  readonly amount = input.required<number>();
  protected readonly maxBundles = MAX_BUNDLES_DRAWN;
  protected readonly tone = NOTE_TONE;
  protected readonly words = words;
  protected readonly layout = computed(() => banknotesOf(this.amount()));
  protected readonly bundlesAfterFirst = computed(() => Array.from({ length: Math.max(0, this.layout().bundles - 1) }));
  protected readonly label = computed(() => `${words(this.amount())} francs en billets`);

  protected countOf(count: number): readonly unknown[] {
    return Array.from({ length: count });
  }
}
