import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// A box and its unit, side by side (Q.10): « 15 000 FCFA », « 20 sacs ». The unit is never
// typed, and never mistaken for the price. Its own style, so that no page rule undoes it.
@Component({
  selector: 'app-affixed',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content /><span class="affix">{{ unit() }}</span>`,
  styles: `
    :host { display: flex; align-items: center; gap: 6px; min-inline-size: 0; }
    :host ::ng-deep > input { flex: 1 1 auto; min-inline-size: 0; inline-size: 100%; }
    .affix { flex: none; font-weight: 700; color: var(--color-muted); white-space: nowrap; }
  `,
})
export class Affixed {
  readonly unit = input.required<string>();
}
