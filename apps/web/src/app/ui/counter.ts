import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

// The counter of a gesture (H.4, mockup .compteur): big buttons, never below one — zero is
// declared by its own event (« rien perdu »), never by a counter at zero (CLAUDE.md §4 rule 10).
// What is counted is drawn above it (the pile), projected by the screen.
@Component({
  selector: 'app-counter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="counter">
      <ng-content />
      <div class="line">
        <button type="button" class="step minus" [disabled]="value() <= 1" (click)="value.set(atLeastOne(value() - 1))" [attr.aria-label]="lessLabel()">−</button>
        <output class="number" aria-live="polite">{{ value() }}</output>
        <button type="button" class="step plus" (click)="value.set(value() + 1)" [attr.aria-label]="moreLabel()">+</button>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .counter {
      padding: 14px;
      background: var(--color-shell);
      background-image: var(--notebook-lines);
      border: 2px solid var(--color-card-edge);
    }
    .line { display: flex; align-items: center; justify-content: center; gap: 18px; }
    .step {
      inline-size: 74px; block-size: 74px;
      min-inline-size: var(--touch-target-min); min-block-size: var(--touch-target-min);
      border: 3px solid var(--color-ink);
      border-radius: var(--radius-blob);
      box-shadow: var(--shadow-hard);
      color: var(--color-on-sign);
      font: 700 2.4rem/1 var(--font-hand);
      cursor: pointer;
    }
    .step:active { transform: translate(2px, 2px); box-shadow: var(--shadow-hard-xs); }
    .step:focus-visible { outline: 4px solid var(--color-ink); outline-offset: 2px; }
    .step:disabled { opacity: 0.4; box-shadow: none; transform: none; cursor: not-allowed; }
    .minus { background: var(--color-orange); }
    .plus { background: var(--color-pasture); }
    .number { min-inline-size: 84px; text-align: center; font: 700 2.9rem var(--font-hand); color: var(--color-earth); }
  `,
})
export class Counter {
  // The floor holds even when taps come faster than the screen greys the button out.
  protected readonly atLeastOne = (count: number) => Math.max(1, count);

  /** At least one. */
  readonly value = model(1);
  readonly unit = input('');
  protected readonly lessLabel = computed(() => `Un${this.unit() ? ` ${this.unit()}` : ''} de moins`);
  protected readonly moreLabel = computed(() => `Un${this.unit() ? ` ${this.unit()}` : ''} de plus`);
}
