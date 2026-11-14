import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import type { CaretakerWeighingRequest } from '@contracts';
import { outOfBounds, strainOf, WEIGHING_WEIGHTS } from '@domain/journal';
import { clip, counted, weight, type PhrasePart } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import { MediaQueueFull } from '../../core/outbox/media-queue';
import { JournalSync } from '../../core/sync/journal-sync';
import { Keypad } from '../../ui/keypad';
import { Pictogram } from '../../ui/pictogram';
import { Sheet } from '../../ui/sheet';
import { SpeakerButton } from '../../ui/speaker-button';
import { Stamp, STAMP_MS } from '../../ui/stamp';
import type { DeclarationTarget } from '../notebook/notebook';
import { ScaleDisplay, scaleDigits } from './scale-display';

type Photo = { readonly bytes: Uint8Array; readonly url: string };
/** Five digits: up to 99.999 kg — the farm's scale weighs 40 kg at most. */
const MAX_DIGITS = 5;

/**
 * The weighing card and its gesture (T.2 to T.4; CdC « Les pesées », decisions of 2026-11-12): the
 * chef asked → « Je pèse » says the instruction (five birds, from different corners, not only the big
 * ones) → for each bird, the caretaker copies the digits of the real scale, entering from the right;
 * the voice reads the weight back → five boxes fill; touching one takes it again → « Envoyer » with
 * five weights only → one weighing in the outbox. A weight far from the strain's target for the age
 * turns the screen red and the voice asks to look again; a second gesture keeps it: never blocking.
 * The photo first (T.6): for each bird, the bird on the scale is photographed before anything is
 * typed, and the weight is copied from the photo shown; no photo, no weight. The photos leave with
 * the weighing, one per weight, as operational proof.
 */
@Component({
  selector: 'app-weighing-card',
  imports: [Keypad, Pictogram, ScaleDisplay, Sheet, SpeakerButton, Stamp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (request(); as asked) {
      <section class="card" aria-label="Pesée demandée">
        <p class="head">
          <app-pictogram picto="scale" [decorative]="true" />
          <span>Le chef demande : pèse 5 poulets</span>
          <app-speaker-button phrase="weighing-requested" />
        </p>
        <button type="button" class="weigh" (click)="start()"><app-pictogram picto="check" [decorative]="true" /> Je pèse</button>
      </section>
    }
    <div class="layer">
      <app-sheet [open]="open()" title="Pèse 5 poulets" (closed)="close()">
        <div class="title-row">
          <p class="title"><app-pictogram picto="scale" [decorative]="true" /> {{ step() === 'done' ? 'Cinq poulets pesés' : 'Poulet ' + (at() + 1) }}</p>
          <button type="button" class="close" (click)="close()" aria-label="Fermer sans rien écrire"><app-pictogram picto="cross" [decorative]="true" /></button>
        </div>
        <ol class="slots" aria-label="Les cinq poids">
          @for (grams of weights(); track $index) {
            <li>
              <button type="button" class="slot" [class.filled]="grams !== null" [class.current]="$index === at()" (click)="takeAgain($index)" [attr.aria-label]="grams === null ? 'Poulet ' + ($index + 1) : 'Poulet ' + ($index + 1) + ', ' + digitsOf(grams) + ' kilo, toucher pour reprendre'">
                {{ grams === null ? $index + 1 : digitsOf(grams) }}
              </button>
            </li>
          }
        </ol>
        @if (cameraRefused()) {
          <p class="trouble" role="alert"><app-pictogram picto="camera" [decorative]="true" /> L’appareil photo ne s’ouvre pas. Sans photo, pas de pesée. Appelle le chef.</p>
        } @else if (trouble(); as words) {
          <p class="trouble" role="alert"><app-pictogram picto="sync-cloud" [decorative]="true" /> {{ words }}</p>
        }
        @if (step() === 'photo') {
          <div class="viewfinder"><app-pictogram picto="scale" [decorative]="true" /></div>
          <button type="button" class="shoot" (click)="shoot()"><app-pictogram picto="camera-white" [decorative]="true" /> Photo de la balance</button>
        } @else if (step() === 'weight') {
          <!-- The photo beside the screen, small: the weight to type always in sight. Touched, it opens wide to read. -->
          <div class="reading">
            @if (photoUrl(); as url) {
              <button type="button" class="photo-button" (click)="zoomed.set(true)" aria-label="Agrandir la photo de la balance">
                <img class="photo" [src]="url" alt="La photo de la balance : recopie le poids qu'elle montre" />
              </button>
            }
            <app-scale-display [grams]="typed()" [wrong]="warned()" />
          </div>
          <app-keypad class="keys compact" [compact]="true" (digit)="press($event)" (erase)="erase()" />
          <button type="button" class="take" [class.keep]="warned()" [disabled]="digits() === ''" (click)="take()">
            <app-pictogram picto="check" [decorative]="true" /> {{ warned() ? 'Garder ce poids' : 'C’est le poids' }}
          </button>
        }
        @if (step() === 'done') {
          <div class="actions">
            <button type="button" class="yes send" [disabled]="!complete() || saving()" (click)="send()"><app-pictogram picto="check" [decorative]="true" /> Envoyer</button>
          </div>
        }
        @if (zoomed() && photoUrl(); as url) {
          <button type="button" class="zoom" (click)="zoomed.set(false)" aria-label="Refermer la photo"><img [src]="url" alt="La photo de la balance, en grand" /></button>
        }
      </app-sheet>
      <app-stamp [shown]="stamped()" />
    </div>
    <input #camera class="camera" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="photoTaken($event)" />
  `,
  styles: `
    :host { display: block; }
    .card {
      margin: 14px 0; padding: 12px 14px; background: var(--color-slot-active);
      border: 3px solid var(--color-blue); border-radius: var(--radius-wobble-3); box-shadow: var(--shadow-hard-sm); transform: rotate(0.4deg);
    }
    .head { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font: 700 1.1rem var(--font-hand); color: var(--color-blue); }
    .head app-pictogram { inline-size: 42px; block-size: 42px; flex: none; }
    .head span { flex: 1; }
    .weigh {
      inline-size: 100%; min-block-size: 64px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-blue); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .weigh app-pictogram { inline-size: 28px; block-size: 28px; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
    .title-row { display: flex; align-items: center; gap: 8px; margin: 2px 0 6px; }
    .title { flex: 1; display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .close {
      flex: none; display: grid; place-items: center; inline-size: 48px; block-size: 48px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-blob); background: var(--color-neutral); box-shadow: var(--shadow-hard-sm);
    }
    .close app-pictogram { inline-size: 24px; block-size: 24px; }
    .reading { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; margin-block-end: 10px; }
    .reading app-scale-display { justify-self: end; }
    .photo-button { padding: 0; border: 3px solid var(--color-pasture); background: var(--color-shell); cursor: zoom-in; }
    .zoom { position: absolute; inset: 0; z-index: 2; display: grid; place-items: center; padding: 8px; border: 0; background: var(--color-veil); cursor: zoom-out; }
    .zoom img { max-inline-size: 100%; max-block-size: 100%; object-fit: contain; border: 3px solid var(--color-paper); }
    .title app-pictogram { inline-size: 36px; block-size: 36px; }
    .slots { list-style: none; display: flex; justify-content: center; gap: 6px; margin: 0 0 10px; padding: 0; }
    .slot {
      inline-size: 56px; min-block-size: 52px; padding: 0 2px; cursor: pointer; border: 3px dashed var(--color-card-edge); border-radius: 50% 46% 52% 48%;
      background: var(--color-slot); font: 700 0.9rem var(--font-hand); color: var(--color-muted); font-variant-numeric: tabular-nums;
    }
    .slot.filled { border: 3px solid var(--color-pasture); background: var(--color-pasture-light); color: var(--color-ink); }
    .slot.current { border-color: var(--color-blue); background: var(--color-slot-active); color: var(--color-blue); }
    .keys { margin-block-end: 10px; }
    .take:active, .actions button:active, .weigh:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .camera { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
    .viewfinder { display: grid; place-items: center; min-block-size: 140px; margin-block-end: 12px; border: 3px dashed var(--color-card-edge); background: var(--color-shell); }
    .viewfinder app-pictogram { inline-size: 72px; block-size: 72px; opacity: 0.45; }
    .photo { display: block; inline-size: 100%; block-size: 96px; object-fit: cover; }
    .trouble { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; padding: 8px 10px; border: 2px dashed var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font: 700 1rem var(--font-hand); }
    .trouble app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .shoot, .take {
      inline-size: 100%; min-block-size: 60px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-blue); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .take.keep { background: var(--color-alert); }
    .shoot app-pictogram, .take app-pictogram { inline-size: 26px; block-size: 26px; }
    .actions { display: flex; gap: 12px; margin-block-start: 12px; }
    .actions button {
      min-block-size: 64px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); font: 700 1.15rem var(--font-hand);
    }
    .actions app-pictogram { inline-size: 30px; block-size: 30px; }
    .no { flex: 1; background: var(--color-neutral); color: var(--color-on-sign); }
    .yes { flex: 2; background: var(--color-pasture); color: var(--color-on-sign); }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    button:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class WeighingCard {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly reduce = inject(REDUCE_PHOTO);
  private readonly camera = viewChild.required<ElementRef<HTMLInputElement>>('camera');

  /** The weighings the chef asked for, not answered yet: the card answers the earliest. */
  readonly requests = input.required<readonly CaretakerWeighingRequest[]>();
  /** Where the weighing is written: the site, the campaign and the day chosen in the notebook. */
  readonly target = input.required<DeclarationTarget>();
  /** The strain placed and the age of the flock: what bounds a plausible weight (T.3). */
  readonly strain = input<string | null>(null);
  readonly campaignDay = input(0);

  protected readonly open = signal(false);
  protected readonly weights = signal<readonly (number | null)[]>(Array.from({ length: WEIGHING_WEIGHTS }, () => null));
  /** The photo of the scale for each bird (T.6): taken first, kept until it leaves. */
  private readonly photos = signal<readonly (Photo | null)[]>(Array.from({ length: WEIGHING_WEIGHTS }, () => null));
  protected readonly at = signal(0);
  /** For the current bird: its photo first, then its weight; `done` once five are taken. */
  protected readonly step = signal<'photo' | 'weight' | 'done'>('photo');
  protected readonly digits = signal('');
  /** The weight typed looked wrong and was said so: the next « take » keeps it. */
  protected readonly warned = signal(false);
  protected readonly cameraRefused = signal(false);
  /** The photo opened wide, to read the digits. */
  protected readonly zoomed = signal(false);
  protected readonly trouble = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  private openedOn: { readonly target: DeclarationTarget; readonly request: CaretakerWeighingRequest } | null = null;

  protected readonly request = computed(() => this.requests()[0] ?? null);
  protected readonly typed = computed(() => Number(this.digits() || '0'));
  protected readonly photoUrl = computed(() => this.photos()[this.at()]?.url ?? null);
  protected readonly complete = computed(() => this.weights().every((grams) => grams !== null) && this.photos().every((photo) => photo !== null));
  private readonly strainOfFlock = computed(() => strainOf(this.strain() ?? ''));

  protected digitsOf(grams: number): string {
    return scaleDigits(grams);
  }

  protected start(): void {
    const request = this.request();
    if (request === null) return;
    this.openedOn = { target: this.target(), request };
    this.forgetPhotos();
    this.weights.set(Array.from({ length: WEIGHING_WEIGHTS }, () => null));
    this.trouble.set(null);
    this.open.set(true);
    this.goTo(0);
    void this.voice.say([clip('weighing-requested'), ...this.askFor(0)]);
  }

  protected shoot(): void {
    this.cameraRefused.set(false);
    this.camera().nativeElement.value = '';
    this.camera().nativeElement.click();
  }

  /** The photo of the bird on the scale: kept, shown above the screen, then the weight is typed from it. */
  protected async photoTaken(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    let bytes: Uint8Array;
    try {
      bytes = await this.reduce(file);
    } catch {
      this.cameraRefused.set(true);
      void this.voice.say([clip('weighing-camera-refused')]);
      return;
    }
    const at = this.at();
    const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }));
    this.photos.update((photos) =>
      photos.map((photo, index) => {
        if (index !== at) return photo;
        if (photo !== null) URL.revokeObjectURL(photo.url);
        return { bytes, url };
      }),
    );
    this.clearTyped();
    this.step.set('weight');
    void this.voice.say([clip('weighing-type-from-photo')]);
  }

  protected press(key: string): void {
    this.warned.set(false);
    if (this.digits().length >= MAX_DIGITS || (this.digits() === '' && key === '0')) return;
    this.digits.update((digits) => digits + key);
  }

  protected erase(): void {
    this.warned.set(false);
    this.digits.update((digits) => digits.slice(0, -1));
  }

  /** Takes the weight typed into the current box — after a warning when it looks wrong (T.3). */
  protected take(): void {
    const grams = this.typed();
    if (grams < 1 || this.photos()[this.at()] === null) return;
    const strain = this.strainOfFlock();
    if (!this.warned() && strain !== null && outOfBounds(strain, this.campaignDay(), grams)) {
      this.warned.set(true);
      void this.voice.say([clip('weighing-implausible')]);
      return;
    }
    const at = this.at();
    this.weights.update((weights) => weights.map((value, index) => (index === at ? grams : value)));
    const next = this.weights().findIndex((value) => value === null);
    const said: PhrasePart[] = [weight(grams)];
    if (next === -1) {
      this.clearTyped();
      this.step.set('done');
      said.push(clip('weighing-all-done'));
    } else {
      this.goTo(next);
      said.push(clip('weighing-next'), ...this.askFor(next));
    }
    void this.voice.say(said);
  }

  /** Touching a box takes that bird again: a new photo, then a new weight. */
  protected takeAgain(index: number): void {
    this.goTo(index);
    void this.voice.say(this.askFor(index));
  }

  protected async send(): Promise<void> {
    const opened = this.openedOn;
    const weights = this.weights();
    const photos = this.photos();
    if (this.saving() || opened === null || weights.some((grams) => grams === null) || photos.some((photo) => photo === null)) return;
    this.saving.set(true);
    try {
      const fingerprints: string[] = [];
      for (const photo of photos as Photo[]) fingerprints.push(await this.sync.keepMedia(photo.bytes, 'image/jpeg', 'OperationalProof'));
      await this.sync.record({
        ...opened.target,
        recordedAt: this.clock.now().toISOString(),
        fact: { type: 'Weighing', weighingRequestId: opened.request.weighingRequestId, weights: weights as number[], photos: fingerprints },
      });
      this.close();
      this.stamped.set(true);
      void this.voice.say([clip('weighing-sent')]);
      setTimeout(() => this.stamped.set(false), STAMP_MS);
    } catch (error) {
      const full = error instanceof MediaQueueFull;
      this.trouble.set(full ? 'Le téléphone est plein de photos qui attendent le réseau. Va où il y a du réseau, puis recommence.' : 'Le téléphone n’arrive plus à garder la pesée. Appelle le chef.');
      void this.voice.say([clip(full ? 'photo-phone-full' : 'storage-full')]);
    } finally {
      this.saving.set(false);
    }
  }

  protected close(): void {
    this.open.set(false);
    this.openedOn = null;
    this.cameraRefused.set(false);
    this.clearTyped();
    this.forgetPhotos();
  }

  private goTo(index: number): void {
    this.zoomed.set(false);
    this.at.set(index);
    this.clearTyped();
    this.cameraRefused.set(false);
    this.step.set('photo');
  }

  private askFor(index: number): PhrasePart[] {
    return [counted('weighing-chicken', index + 1), clip('weighing-photo')];
  }

  private clearTyped(): void {
    this.digits.set('');
    this.warned.set(false);
  }

  private forgetPhotos(): void {
    for (const photo of this.photos()) if (photo !== null) URL.revokeObjectURL(photo.url);
    this.photos.set(Array.from({ length: WEIGHING_WEIGHTS }, () => null));
  }
}
