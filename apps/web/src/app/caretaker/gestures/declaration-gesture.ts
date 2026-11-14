import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import type { FactPayload } from '@contracts';
import { clip } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { MediaQueueFull } from '../../core/outbox/media-queue';
import { JournalSync } from '../../core/sync/journal-sync';
import { GestureButton } from '../../ui/gesture-button';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import type { DeclarationTarget } from '../notebook/notebook';
import type { NotebookDay } from '../notebook/notebook-view';
import { CountSheets } from './count-sheets';
import type { Gesture } from './gesture';
import { STAMP_MS } from '../../ui/stamp';

type DeathAnswer = { readonly kind: 'Photographed'; readonly media: string } | { readonly kind: 'NoPhoto' } | null;

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
    } @else if (noPhoto(); as words) {
      <app-post-it class="failed">
        <p role="alert"><app-pictogram picto="camera" [decorative]="true" /> {{ words }}</p>
      </app-post-it>
    }
    <app-count-sheets
      [gesture]="gesture()"
      [when]="when()"
      [alreadyWritten]="alreadyWritten()"
      [saving]="saving()"
      [stamped]="stamped()"
      [askPhoto]="gesture().photographed === true"
      (confirmed)="write($event, noPhotoAnswer())"
      (showing)="show($event)"
    />
    <input #camera class="camera" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="photoTaken($event)" />
  `,
  styles: `
    :host { display: block; }
    .failed { display: block; margin-block-start: 10px; }
    .failed p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .failed app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .camera { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
  `,
})
export class DeclarationGesture {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly sheets = viewChild.required(CountSheets);
  private readonly camera = viewChild.required<ElementRef<HTMLInputElement>>('camera');
  private readonly reduce = inject(REDUCE_PHOTO);

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
  /** Why the dead were written without the photo the caretaker meant to take (K.6). */
  protected readonly noPhoto = signal<string | null>(null);
  /** The count waiting for its photo, once « Oui, je montre » is touched. */
  private showingCount: number | null = null;
  // The target as it stood when the counter opened: what the caretaker saw is what is written.
  private openedOn: DeclarationTarget | null = null;

  protected open(): void {
    this.openedOn = this.target();
    this.failed.set(false);
    this.noPhoto.set(null);
    this.sheets().open(1, this.gesture().howMany);
  }

  /** For the dead, « Oui, pas de photo » is an answer (K.6); a bag carries none. */
  protected noPhotoAnswer(): DeathAnswer {
    return this.gesture().photographed === true ? { kind: 'NoPhoto' } : null;
  }

  /** « Oui, je montre »: the instruction is said, then the camera opens. */
  protected show(quantity: number): void {
    this.showingCount = quantity;
    void this.voice.say([clip('deaths-photo-advice')]);
    this.camera().nativeElement.value = '';
    this.camera().nativeElement.click();
  }

  /** The photo of the dead kept as operational proof, then the declaration that cites it; no photo if the camera fails — never blocking. */
  protected async photoTaken(event: Event): Promise<void> {
    const quantity = this.showingCount;
    const file = (event.target as HTMLInputElement).files?.[0];
    if (quantity === null || file === undefined) return;
    this.showingCount = null;
    try {
      const bytes = await this.reduce(file);
      const media = await this.sync.keepMedia(bytes, 'image/jpeg', 'OperationalProof');
      await this.write(quantity, { kind: 'Photographed', media });
    } catch (error) {
      this.noPhoto.set(error instanceof MediaQueueFull ? 'Le téléphone est plein de photos qui attendent le réseau. Les morts sont écrits sans photo.' : 'L’appareil photo ne s’ouvre pas. Les morts sont écrits sans photo.');
      void this.voice.say([clip(error instanceof MediaQueueFull ? 'photo-phone-full' : 'deaths-camera-refused')]);
      await this.write(quantity, { kind: 'NoPhoto' });
    }
  }

  protected async write(quantity: number, answer: DeathAnswer = null): Promise<void> {
    const target = this.openedOn;
    if (this.saving() || target === null) {
      return;
    }
    this.saving.set(true);
    try {
      const fact: FactPayload = this.gesture().fact === 'Death' ? { type: 'Death', quantity, ...(answer === null ? {} : { deathEvidence: answer }) } : { type: 'BagOpened', quantity };
      await this.sync.record({ ...target, recordedAt: this.clock.now().toISOString(), fact });
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
