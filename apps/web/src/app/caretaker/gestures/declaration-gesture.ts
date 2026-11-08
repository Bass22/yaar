import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { clip } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { JournalSync } from '../../core/sync/journal-sync';
import { Counter } from '../../ui/counter';
import { GestureButton } from '../../ui/gesture-button';
import { Pictogram } from '../../ui/pictogram';
import { Pile } from '../../ui/pile';
import { PostIt } from '../../ui/post-it';
import { Sheet } from '../../ui/sheet';
import { Stamp } from '../../ui/stamp';
import { lineOf } from '../notebook/day-journal';
import type { DeclarationTarget } from '../notebook/notebook';
import type { NotebookDay } from '../notebook/notebook-view';
import type { Gesture } from './gesture';

const STAMP_MS = 1500;

// A gesture in three taps (K.1, K.2, mockup journal-gardien.html): the gesture → the counter, one
// drawn object per unit → « C'est tout » → the read-back, said aloud → Oui. The stamp only comes
// down once the outbox has kept the event (G.3). Non writes nothing. Deaths and opened bags take
// the same path; only what is drawn, said and written differs (`Gesture`).
@Component({
  selector: 'app-declaration-gesture',
  imports: [Counter, GestureButton, Pictogram, Pile, PostIt, Sheet, Stamp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'gesture().name' },
  template: `
    <app-gesture-button [picto]="gesture().picto" [label]="gesture().label" [tone]="gesture().name" (click)="open()" />
    @if (failed()) {
      <app-post-it class="failed">
        <p role="alert"><app-pictogram picto="cross" [decorative]="true" /> Le téléphone n’arrive plus à garder tes déclarations. Appelle le chef.</p>
      </app-post-it>
    }
    <div class="layer">
      <app-sheet [open]="step() === 'count'" [title]="gesture().title" (closed)="close()">
        <p class="title">{{ gesture().title }}</p>
        @if (when() !== 'today') {
          <p class="for">{{ forDay() }}</p>
        }
        <app-counter [(value)]="count" [unit]="gesture().unit">
          <app-pile [kind]="gesture().name" [count]="count()" [label]="counted()" />
        </app-counter>
        <div class="actions">
          <button type="button" class="no" (click)="close()" aria-label="Fermer sans rien écrire"><app-pictogram picto="cross" [decorative]="true" /></button>
          <button type="button" class="yes" (click)="readBack()"><app-pictogram picto="check" [decorative]="true" /> C'est tout</button>
        </div>
      </app-sheet>
      <app-sheet [open]="step() === 'confirm'" title="C'est bien ça ?" (closed)="cancel()">
        <p class="title">C'est bien ça ?</p>
        <app-pile [kind]="gesture().name" [count]="count()" [label]="counted()" />
        <p class="phrase">{{ confirmation().words }}</p>
        @if (confirmation().already; as already) {
          <p class="already">{{ already }}</p>
        }
        <div class="actions">
          <button type="button" class="no" (click)="cancel()"><app-pictogram picto="cross" [decorative]="true" /> Non</button>
          <button type="button" class="yes" [disabled]="saving()" (click)="write()"><app-pictogram picto="check" [decorative]="true" /> Oui</button>
        </div>
      </app-sheet>
      <app-stamp [shown]="stamped()" word="C’est noté !" />
    </div>
  `,
  styles: `
    :host { display: block; }
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
    .no { flex: 1; background: var(--color-paper); color: var(--color-earth); }
    .yes { flex: 2; background: var(--color-pasture); color: var(--color-on-sign); }
    .yes:disabled { opacity: 0.6; cursor: wait; }
    .failed { display: block; margin-block-start: 10px; }
    .failed p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .failed app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
  `,
})
export class DeclarationGesture {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);

  /** What is counted, drawn, said and written: `DEATHS`, `BAGS`. */
  readonly gesture = input.required<Gesture>();
  /** Where the declaration is written: the site, the campaign and the day chosen in the notebook. */
  readonly target = input.required<DeclarationTarget>();
  readonly when = input.required<NotebookDay['when']>();
  /** What is already written of this type that day, by anyone; `null` when nothing. */
  readonly alreadyWritten = input<number | null>(null);

  protected readonly step = signal<'closed' | 'count' | 'confirm'>('closed');
  protected readonly count = signal(1);
  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  protected readonly failed = signal(false);
  protected readonly confirmation = computed(() => this.gesture().confirmationOf(this.count(), this.when(), this.alreadyWritten()));
  /** « 2 sacs ouverts », as the notebook line will say it. */
  protected readonly counted = computed(() => lineOf({ type: this.gesture().fact, quantity: this.count() }).words);
  protected readonly forDay = computed(() => (this.when() === 'yesterday' ? 'Pour hier' : 'Pour avant-hier'));
  // The target as it stood when the counter opened: what the caretaker saw is what is written.
  private openedOn: DeclarationTarget | null = null;

  protected open(): void {
    this.openedOn = this.target();
    this.count.set(1);
    this.failed.set(false);
    this.step.set('count');
    void this.voice.say([clip(this.gesture().howMany)]);
  }

  protected readBack(): void {
    this.step.set('confirm');
    void this.voice.say(this.confirmation().phrase);
  }

  protected close(): void {
    this.step.set('closed');
    this.voice.stop();
  }

  protected cancel(): void {
    if (this.step() !== 'confirm') {
      return;
    }
    this.step.set('closed');
    void this.voice.say([clip('cancelled')]);
  }

  protected async write(): Promise<void> {
    const target = this.openedOn;
    if (this.saving() || this.step() !== 'confirm' || target === null) {
      return;
    }
    this.saving.set(true);
    try {
      await this.sync.record({ ...target, recordedAt: this.clock.now().toISOString(), fact: { type: this.gesture().fact, quantity: this.count() } });
      this.step.set('closed');
      this.stamped.set(true);
      void this.voice.say([clip('written-thanks')]);
      setTimeout(() => this.stamped.set(false), STAMP_MS);
    } catch {
      // Nothing is shown as written: the caretaker is told, the chef will help.
      this.step.set('closed');
      this.failed.set(true);
      void this.voice.say([clip('storage-full')]);
    } finally {
      this.saving.set(false);
    }
  }
}
