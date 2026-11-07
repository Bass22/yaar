import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

// A sheet that rises from the bottom of the notebook (H.4, mockup .feuille): the counter, the
// confirmation. A veil darkens the page behind it; touching the veil, or Escape, closes it.
// It only moves by `transform`, and the veil only fades by `opacity` (CLAUDE.md §4 rule 12).
@Component({
  selector: 'app-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'open() && closed.emit()' },
  template: `
    <div class="veil" [class.on]="open()" (click)="closed.emit()" aria-hidden="true"></div>
    <section class="sheet" [class.on]="open()" role="dialog" [attr.aria-label]="title()" [attr.aria-hidden]="open() ? null : 'true'" [attr.inert]="open() ? null : ''">
      <ng-content />
    </section>
  `,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 5; }
    .veil {
      position: absolute; inset: 0;
      background: var(--color-veil);
      opacity: 0; transition: opacity 0.2s;
    }
    .veil.on { opacity: 1; pointer-events: auto; }
    .sheet {
      position: absolute; inset-inline: 0; inset-block-end: 0;
      max-block-size: 88%; overflow-y: auto;
      padding: 14px 16px 22px;
      background: var(--color-paper);
      border-block-start: 3px dashed var(--color-card-edge);
      box-shadow: var(--shadow-sheet);
      transform: translateY(105%); transition: transform 0.25s ease;
    }
    .sheet.on { transform: translateY(0); pointer-events: auto; }
  `,
})
export class Sheet {
  readonly open = input(false);
  /** What a screen reader announces: « Combien de morts ? », « C'est bien ça ? ». */
  readonly title = input.required<string>();
  readonly closed = output<void>();
}
