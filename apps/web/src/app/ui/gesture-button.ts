import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { PictogramName } from '@design-system';
import { Pictogram } from './pictogram';

/** The painted signs of the notebook (mockup .geste): one colour per gesture. */
export type GestureTone = 'death' | 'bag' | 'voice' | 'photo';

// A gesture of the caretaker (H.3): pictogram, colour and words — three channels, never one
// alone. It sinks when pressed; its focus is visible.
@Component({
  selector: 'app-gesture-button',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="gesture" [class]="'tone-' + tone()">
      <app-pictogram class="picto" [picto]="picto()" [decorative]="true" />
      <span>{{ label() }}</span>
    </button>
  `,
  styles: `
    :host { display: block; }
    .gesture {
      inline-size: 100%;
      min-block-size: var(--touch-target-min);
      display: flex; flex-direction: column; align-items: center; gap: 7px;
      padding: 14px 8px 12px;
      border: 3px solid var(--color-ink);
      border-radius: var(--radius-wobble-1);
      box-shadow: var(--shadow-hard);
      color: var(--color-on-sign);
      font: 700 1.05rem var(--font-hand);
      cursor: pointer;
      transition: transform 0.1s;
    }
    .gesture:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .gesture:focus-visible { outline: 4px solid var(--color-ink); outline-offset: 2px; }
    .picto { inline-size: 64px; block-size: 46px; }
    .tone-death { background-color: var(--color-alert); }
    .tone-bag { background-color: var(--color-bag); }
    .tone-voice { background-color: var(--color-blue); }
    .tone-photo { background-color: var(--color-photo); }
  `,
})
export class GestureButton {
  readonly picto = input.required<PictogramName>();
  readonly label = input.required<string>();
  readonly tone = input.required<GestureTone>();
}
