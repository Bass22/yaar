import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { AudioLanguage } from '@contracts';
import { clip as clipPart, type PhrasePart } from '../core/audio/phrase';
import type { ScriptClip } from '../core/audio/script-clips';
import { Voice } from '../core/audio/voice';
import { Pictogram } from './pictogram';

// The speaker (journal-gardien.html .hp-mini): a tap says the phrase next to it, in recorded
// clips. 48 px at least, like every target of the notebook.
@Component({
  selector: 'app-speaker-button',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" class="speaker" [attr.aria-label]="label()" (click)="speak()"><app-pictogram picto="speaker" [decorative]="true" /></button>`,
  styles: `
    :host { display: inline-flex; flex: none; }
    .speaker {
      inline-size: var(--touch-target-min); block-size: var(--touch-target-min);
      display: flex; align-items: center; justify-content: center;
      border: none; border-radius: var(--radius-blob); background: var(--color-earth); box-shadow: var(--shadow-hard-sm); cursor: pointer;
    }
    .speaker:active { transform: translate(1px, 1px); }
    .speaker:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    app-pictogram { inline-size: 24px; block-size: 24px; }
  `,
})
export class SpeakerButton {
  private readonly voice = inject(Voice);
  /** A clip of the script, or a whole phrase. */
  readonly phrase = input.required<ScriptClip | readonly PhrasePart[]>();
  readonly language = input<AudioLanguage | null>(null);
  readonly label = input('Écouter');

  protected speak(): void {
    const phrase = this.phrase();
    void this.voice.say(typeof phrase === 'string' ? [clipPart(phrase)] : phrase, this.language() ?? undefined);
  }
}
