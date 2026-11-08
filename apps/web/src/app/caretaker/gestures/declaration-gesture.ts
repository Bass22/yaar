import { ChangeDetectionStrategy, Component, inject, input, signal, viewChild } from '@angular/core';
import { clip } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { JournalSync } from '../../core/sync/journal-sync';
import { GestureButton } from '../../ui/gesture-button';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import type { DeclarationTarget } from '../notebook/notebook';
import type { NotebookDay } from '../notebook/notebook-view';
import { CountSheets } from './count-sheets';
import type { Gesture } from './gesture';

const STAMP_MS = 1500;

// A gesture in three taps (K.1, K.2): the gesture → the count sheets → Oui. The stamp only comes
// down once the outbox has kept the event (G.3). Deaths and opened bags take the same path; only
// what is drawn, said and written differs (`Gesture`).
@Component({
  selector: 'app-declaration-gesture',
  imports: [CountSheets, GestureButton, Pictogram, PostIt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'gesture().name' },
  template: `
    <app-gesture-button [picto]="gesture().picto" [label]="gesture().label" [tone]="gesture().name" (click)="open()" />
    @if (failed()) {
      <app-post-it class="failed">
        <p role="alert"><app-pictogram picto="cross" [decorative]="true" /> Le téléphone n’arrive plus à garder tes déclarations. Appelle le chef.</p>
      </app-post-it>
    }
    <app-count-sheets [gesture]="gesture()" [when]="when()" [alreadyWritten]="alreadyWritten()" [saving]="saving()" [stamped]="stamped()" (confirmed)="write($event)" />
  `,
  styles: `
    :host { display: block; }
    .failed { display: block; margin-block-start: 10px; }
    .failed p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .failed app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
  `,
})
export class DeclarationGesture {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly sheets = viewChild.required(CountSheets);

  /** What is counted, drawn, said and written: `DEATHS`, `BAGS`. */
  readonly gesture = input.required<Gesture>();
  /** Where the declaration is written: the site, the campaign and the day chosen in the notebook. */
  readonly target = input.required<DeclarationTarget>();
  readonly when = input.required<NotebookDay['when']>();
  /** What is already written of this type that day, by anyone; `null` when nothing. */
  readonly alreadyWritten = input<number | null>(null);

  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  protected readonly failed = signal(false);
  // The target as it stood when the counter opened: what the caretaker saw is what is written.
  private openedOn: DeclarationTarget | null = null;

  protected open(): void {
    this.openedOn = this.target();
    this.failed.set(false);
    this.sheets().open(1, this.gesture().howMany);
  }

  protected async write(quantity: number): Promise<void> {
    const target = this.openedOn;
    if (this.saving() || target === null) {
      return;
    }
    this.saving.set(true);
    try {
      await this.sync.record({ ...target, recordedAt: this.clock.now().toISOString(), fact: { type: this.gesture().fact, quantity } });
      this.sheets().close();
      this.stamped.set(true);
      void this.voice.say([clip('written-thanks')]);
      setTimeout(() => this.stamped.set(false), STAMP_MS);
    } catch {
      // Nothing is shown as written: the caretaker is told, the chef will help.
      this.sheets().close();
      this.failed.set(true);
      void this.voice.say([clip('storage-full')]);
    } finally {
      this.saving.set(false);
    }
  }
}
