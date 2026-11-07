import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { PICTOGRAM_LABELS, type PictogramName } from '@design-system';

// A pictogram of the « cahier », baked at build time (H.2): no filter, no drawing at runtime.
// It says its name to a screen reader, unless it only decorates a text that already says it.
@Component({
  selector: 'app-pictogram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.role]="decorative() ? null : 'img'"
      [attr.aria-label]="decorative() ? null : name()"
      [attr.aria-hidden]="decorative() ? 'true' : null"
      focusable="false"
    >
      <use [attr.href]="href()" />
    </svg>
  `,
  styles: `
    :host { display: inline-flex; }
    svg { width: 100%; height: 100%; display: block; }
  `,
})
export class Pictogram {
  readonly picto = input.required<PictogramName>();
  /** The words for it; by default the name the design system gives it. */
  readonly label = input<string | null>(null);
  /** Only decorates a text that says the same: hidden from screen readers. */
  readonly decorative = input(false);

  protected readonly name = computed(() => this.label() ?? PICTOGRAM_LABELS[this.picto()]);
  protected readonly href = computed(() => `pictograms.svg#${this.picto()}`);
}
