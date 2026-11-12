import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Grams as the farm's scale shows them, in kilos with a point: 1820 → « 1.820 », 18 → « 0.018 ». */
export const scaleDigits = (grams: number): string => `${Math.floor(grams / 1000)}.${String(grams % 1000).padStart(3, '0')}`;

// The screen of the farm's scale (T.3; founder's photo of 2026-11-12): a dark panel, a blue
// « WEIGHT (kg) » tag, a lit green screen, the weight in kilos with a point. The caretaker copies
// what the photo of the scale shows. Red when the weight looks wrong for the age of the flock.
@Component({
  selector: 'app-scale-display',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="display" [class.wrong]="wrong()" role="status" [attr.aria-label]="label()">
      <span class="tag" aria-hidden="true">WEIGHT (kg)</span>
      <span class="screen"><span class="digits">{{ digits() }}</span></span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .display {
      display: grid; justify-items: center; gap: 6px; inline-size: max-content; margin: 0 auto 12px; padding: 8px 12px 10px;
      background: var(--color-scale-body); border-radius: 10px; box-shadow: var(--shadow-hard-sm);
    }
    .tag { padding: 1px 10px; border-radius: 3px; background: var(--color-blue); color: var(--color-on-sign); font: 700 0.75rem var(--font-reading); letter-spacing: 0.5px; }
    .screen { display: block; min-inline-size: 172px; padding: 4px 12px; background: var(--color-scale-screen); border-radius: 4px; text-align: end; }
    .digits { font: 700 2.6rem/1.1 'Courier New', monospace; letter-spacing: 2px; color: var(--color-scale-digits); font-variant-numeric: tabular-nums; }
    .display.wrong { background: var(--color-alert); }
    .display.wrong .screen { background: var(--color-alert-light); }
    .display.wrong .digits { color: var(--color-alert); }
  `,
})
export class ScaleDisplay {
  /** The weight typed, in grams. */
  readonly grams = input.required<number>();
  readonly wrong = input(false);

  protected readonly digits = computed(() => scaleDigits(this.grams()));
  protected readonly label = computed(() => {
    const grams = this.grams();
    const kilos = Math.floor(grams / 1000);
    return `${kilos > 0 ? `${kilos} kilo${kilos > 1 ? 's' : ''} ` : ''}${grams % 1000} grammes${this.wrong() ? ', ce poids paraît faux' : ''}`;
  });
}
