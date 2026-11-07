import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** The edge of a card: plain paper, or the colour of what it announces (a delivery, a weighing). */
export type CardTone = 'paper' | 'pasture' | 'blue';

// A card taped on the page (H.3, mockup .sticker and .livraison): paper, a piece of scotch, a
// slight tilt, a hard shadow.
@Component({
  selector: 'app-taped-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="card" [class]="'tone-' + tone()"><ng-content /></div>`,
  styles: `
    :host { display: block; }
    .card {
      position: relative;
      padding: 10px 12px;
      background: var(--color-paper);
      border: 2px solid var(--color-card-edge);
      box-shadow: var(--shadow-hard-sm);
      transform: rotate(-0.8deg);
    }
    .card::before {
      content: '';
      position: absolute; inset-block-start: -9px; inset-inline-start: 18px;
      inline-size: 54px; block-size: 14px;
      background: var(--color-tape);
      border: 1px solid var(--color-tape-edge);
      transform: rotate(-3deg);
    }
    .tone-pasture { border-color: var(--color-pasture); }
    .tone-blue { border-color: var(--color-blue); }
  `,
})
export class TapedCard {
  readonly tone = input<CardTone>('paper');
}
