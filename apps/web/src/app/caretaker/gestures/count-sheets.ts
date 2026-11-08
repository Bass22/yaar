import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { clip } from '../../core/audio/phrase';
import type { ScriptClip } from '../../core/audio/script-clips';
import { Voice } from '../../core/audio/voice';
import { Counter } from '../../ui/counter';
import { Pictogram } from '../../ui/pictogram';
import { Pile } from '../../ui/pile';
import { Sheet } from '../../ui/sheet';
import { Stamp } from '../../ui/stamp';
import { lineOf } from '../notebook/day-journal';
import type { NotebookDay } from '../notebook/notebook-view';
import type { Gesture } from './gesture';

// The two sheets of a count (K.1, K.2, K.5; mockup journal-gardien.html): the counter, one drawn
// object per unit → « C'est tout » → the read-back, said aloud → Oui. They say what is counted;
// what the Oui writes — a declaration, a correction — is the host's. Non writes nothing.
@Component({
  selector: 'app-count-sheets',
  imports: [Counter, Pictogram, Pile, Sheet, Stamp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="layer">
      <app-sheet [open]="step() === 'count'" [title]="shownTitle()" (closed)="dismiss()">
        <p class="title">{{ shownTitle() }}</p>
        @if (when() !== 'today') {
          <p class="for">{{ forDay() }}</p>
        }
        <app-counter [(value)]="count" [unit]="gesture().unit">
          <app-pile [kind]="gesture().name" [count]="count()" [label]="counted()" />
        </app-counter>
        <div class="actions">
          <button type="button" class="no" (click)="dismiss()" aria-label="Fermer sans rien écrire"><app-pictogram picto="cross" [decorative]="true" /></button>
          <button type="button" class="yes" (click)="readBack()"><app-pictogram picto="check" [decorative]="true" /> C'est tout</button>
        </div>
      </app-sheet>
      <app-sheet [open]="step() === 'confirm'" [title]="question()" (closed)="cancel()">
        <p class="title">{{ question() }}</p>
        <app-pile [kind]="gesture().name" [count]="count()" [label]="counted()" />
        <p class="phrase">{{ confirmation().words }}</p>
        @if (confirmation().already; as already) {
          <p class="already">{{ already }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="cancel()"><app-pictogram picto="cross" [decorative]="true" /> Non</button>
          <button type="button" class="yes" [disabled]="saving()" (click)="confirm()"><app-pictogram picto="check" [decorative]="true" /> Oui</button>
        </div>
      </app-sheet>
      <app-stamp [shown]="stamped()" [word]="stampWord()" />
    </div>
  `,
  styles: `
    :host { display: contents; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
    .title { margin: 4px 0 10px; text-align: center; font: 700 1.4rem var(--font-hand); color: var(--color-earth); }
    .for { margin: -6px 0 10px; text-align: center; font: 700 1rem var(--font-hand); color: var(--color-past-day); }
    .phrase { margin: 4px 0; text-align: center; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .already { margin: 6px 0; padding: 8px 10px; border: 2px dashed var(--color-card-edge); font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .actions { display: flex; gap: 12px; margin-block-start: 14px; }
    .actions button {
      min-block-size: 64px; display: flex; align-items: center; justify-content: center; gap: 8px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      font: 700 1.2rem var(--font-hand); cursor: pointer;
    }
    .actions button:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .actions button:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .actions app-pictogram { inline-size: 30px; block-size: 30px; }
    .no { flex: 1; background: var(--color-neutral); color: var(--color-on-sign); }
    .yes { flex: 2; background: var(--color-pasture); color: var(--color-on-sign); }
    .yes:disabled { opacity: 0.6; cursor: wait; }
  `,
})
export class CountSheets {
  private readonly voice = inject(Voice);

  readonly gesture = input.required<Gesture>();
  readonly when = input.required<NotebookDay['when']>();
  /** What is already written of this type that day, by anyone; `null` when nothing, or for a correction. */
  readonly alreadyWritten = input<number | null>(null);
  /** The counter's title when it is not the gesture's: « Corrige le nombre ». */
  readonly title = input<string | null>(null);
  /** The host is writing: the Oui waits. */
  readonly saving = input(false);
  readonly stamped = input(false);
  readonly stampWord = input('C’est noté !');
  /** Oui on the read-back, with the count. */
  readonly confirmed = output<number>();

  protected readonly step = signal<'closed' | 'count' | 'confirm'>('closed');
  protected readonly count = signal(1);
  protected readonly shownTitle = computed(() => this.title() ?? this.gesture().title);
  protected readonly confirmation = computed(() => this.gesture().confirmationOf(this.count(), this.when(), this.alreadyWritten()));
  /** « 2 sacs ouverts », as the notebook line will say it. */
  protected readonly counted = computed(() => lineOf({ type: this.gesture().fact, quantity: this.count() }).words);
  /** What the read-back asks, as the voice asks it: « c'est en plus ? » when the same is already written that day. */
  protected readonly question = computed(() => (this.confirmation().already === null ? "C'est bien ça ?" : 'C’est en plus ?'));
  protected readonly forDay = computed(() => (this.when() === 'yesterday' ? 'Pour hier' : 'Pour avant-hier'));

  /** Opens the counter at `start`, and says what to do. */
  open(start: number, howMany: ScriptClip): void {
    this.count.set(start);
    this.step.set('count');
    void this.voice.say([clip(howMany)]);
  }

  /** Closes after the host has written, or failed to: the host says what happened. */
  close(): void {
    this.step.set('closed');
  }

  protected dismiss(): void {
    this.step.set('closed');
    this.voice.stop();
  }

  protected readBack(): void {
    this.step.set('confirm');
    void this.voice.say(this.confirmation().phrase);
  }

  protected cancel(): void {
    if (this.step() !== 'confirm') {
      return;
    }
    this.step.set('closed');
    void this.voice.say([clip('cancelled')]);
  }

  protected confirm(): void {
    if (this.step() === 'confirm' && !this.saving()) {
      this.confirmed.emit(this.count());
    }
  }
}
