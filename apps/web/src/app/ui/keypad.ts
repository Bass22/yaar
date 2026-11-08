import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Pictogram } from './pictogram';

// The big-key pad of the notebook (journal-gardien-entree.html): digits the caretaker knows
// from dialling numbers, keys of 72 px, an erase key — and, when the screen needs it, a
// validate key in the empty corner.
@Component({
  selector: 'app-keypad',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pad">
      @for (digit of digits; track digit) {
        <button type="button" class="key" [disabled]="disabled()" (click)="digit$.emit(digit)">{{ digit }}</button>
      }
      @if (withValidate()) {
        <button type="button" class="key validate" [disabled]="disabled()" (click)="validate.emit()" aria-label="Valider"><app-pictogram picto="check" [decorative]="true" /></button>
      } @else {
        <span></span>
      }
      <button type="button" class="key" [disabled]="disabled()" (click)="digit$.emit('0')">0</button>
      <button type="button" class="key erase" [disabled]="disabled()" (click)="erase.emit()" aria-label="Effacer"><app-pictogram picto="cross" [decorative]="true" /></button>
    </div>
  `,
  styles: `
    :host { display: block; }
    .pad { display: grid; grid-template-columns: repeat(3, 72px); gap: 12px; justify-content: center; }
    .key {
      block-size: 72px; min-inline-size: var(--touch-target-min);
      border: 3px solid var(--color-ink);
      border-radius: var(--radius-blob);
      background: var(--color-paper);
      box-shadow: var(--shadow-hard-sm);
      font: 700 2rem var(--font-hand);
      color: var(--color-earth);
      cursor: pointer;
    }
    .key:active { transform: translate(1px, 2px); box-shadow: var(--shadow-hard-xs); }
    .key:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .key:disabled { opacity: 0.4; cursor: not-allowed; }
    .erase { background: var(--color-neutral); color: var(--color-on-sign); }
    .validate { background: var(--color-pasture); }
    app-pictogram { inline-size: 28px; block-size: 28px; }
  `,
})
export class Keypad {
  protected readonly digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  readonly withValidate = input(false);
  readonly disabled = input(false);
  // `digit` would clash with the template variable: the output is named digit in the template API.
  readonly digit$ = output<string>({ alias: 'digit' });
  readonly erase = output<void>();
  readonly validate = output<void>();
}
