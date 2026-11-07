import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { PictogramName } from '@design-system';
import { Pictogram } from './pictogram';

/** What a pile draws: deaths and opened bags one by one, a delivery by bundles of four bags. */
export type PileKind = 'death' | 'bag' | 'delivery';

/** Beyond this many, the pile writes the rest as « +n » instead of drawing it. */
export const MAX_DRAWN = 12;
/** A delivery is drawn by bundles of four bags, five bundles per row; beyond fifteen bundles, « +n ». */
export const BAGS_PER_BUNDLE = 4;
export const MAX_BUNDLES = 15;

export type PileLayout = { readonly items: readonly PictogramName[]; readonly more: number };

/** What the pile draws for a count (mockup pictoPile): pictograms, and the rest not drawn. */
export function pileLayout(kind: PileKind, count: number): PileLayout {
  if (kind === 'delivery') {
    const bundles = Math.floor(count / BAGS_PER_BUNDLE);
    if (bundles > MAX_BUNDLES) {
      return { items: Array<PictogramName>(MAX_BUNDLES).fill('bag-bundle'), more: count - MAX_BUNDLES * BAGS_PER_BUNDLE };
    }
    return { items: [...Array<PictogramName>(bundles).fill('bag-bundle'), ...Array<PictogramName>(count % BAGS_PER_BUNDLE).fill('closed-bag')], more: 0 };
  }
  const picto: PictogramName = kind === 'death' ? 'dead-chicken' : 'open-bag';
  return { items: Array<PictogramName>(Math.min(count, MAX_DRAWN)).fill(picto), more: Math.max(0, count - MAX_DRAWN) };
}

// The pile (H.4, mockup .pile): one drawn object per unit counted, so that a caretaker who does
// not read the number sees the quantity. Each new object pops in (transform only).
@Component({
  selector: 'app-pile',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pile" [class.delivery]="kind() === 'delivery'" role="img" [attr.aria-label]="label()">
      @for (picto of layout().items; track $index) {
        <app-pictogram [picto]="picto" [decorative]="true" [class]="picto" />
      }
      @if (layout().more > 0) {
        <span class="more">+{{ layout().more }}</span>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .pile { min-block-size: 86px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center; margin-block-end: 8px; }
    .pile.delivery { display: grid; grid-template-columns: repeat(5, auto); gap: 8px; justify-content: center; align-items: end; }
    app-pictogram { animation: pop 0.18s ease; }
    .dead-chicken { inline-size: 56px; block-size: 37px; }
    .open-bag { inline-size: 38px; block-size: 44px; }
    .bag-bundle { inline-size: 46px; block-size: 46px; }
    .closed-bag { inline-size: 26px; block-size: 34px; }
    .more { font: 700 1.4rem var(--font-hand); color: var(--color-earth); }
    @keyframes pop { from { transform: scale(0.3) rotate(-10deg); } to { transform: scale(1) rotate(0); } }
  `,
})
export class Pile {
  readonly kind = input.required<PileKind>();
  readonly count = input.required<number>();
  /** What the pile shows, in words: the number itself. */
  readonly label = input.required<string>();
  protected readonly layout = computed(() => pileLayout(this.kind(), this.count()));
}
