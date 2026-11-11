import { ChangeDetectionStrategy, Component, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { clip } from '../../../core/audio/phrase';
import { Voice } from '../../../core/audio/voice';
import { CLOCK } from '../../../core/clock';
import { MediaQueueFull } from '../../../core/outbox/media-queue';
import { JournalSync } from '../../../core/sync/journal-sync';
import { GestureButton } from '../../../ui/gesture-button';
import { Pictogram } from '../../../ui/pictogram';
import { PostIt } from '../../../ui/post-it';
import { Sheet } from '../../../ui/sheet';
import { Stamp } from '../../../ui/stamp';
import type { DeclarationTarget } from '../../notebook/notebook';
import { REDUCE_PHOTO } from './reduce-photo';

const STAMP_MS = 1500;

type Trouble = 'camera' | 'full' | 'storage';

// « Photo » (M.3, CdC « La photo au chef »): the phone's camera → the photo in the viewfinder →
// Oui. Reduced on the phone, kept in the media queue, then written in the notebook; it leaves
// with the network without holding the declaration back (M.2).
@Component({
  selector: 'app-photo-gesture',
  imports: [GestureButton, Pictogram, PostIt, Sheet, Stamp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-gesture-button picto="camera-white" label="Photo" tone="photo" (click)="open()" />
    <!-- The phone's own camera: nothing to install, and it works on every Android. -->
    <input #camera class="camera" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="taken($event)" />
    @if (trouble(); as trouble) {
      <app-post-it class="trouble">
        <p role="alert">
          <app-pictogram [picto]="trouble === 'full' ? 'sync-cloud' : 'camera'" [decorative]="true" />
          {{ troubleWords[trouble] }}
        </p>
      </app-post-it>
    }
    <div class="layer">
      <app-sheet [open]="preview() !== null" title="Montre au chef" (closed)="dismiss()">
        <p class="title"><app-pictogram picto="camera" [decorative]="true" /> Montre au chef</p>
        @if (preview(); as url) {
          <img class="viewfinder" [src]="url" alt="La photo prise" />
        }
        <div class="actions">
          <button type="button" class="no" (click)="dismiss()" aria-label="Ne pas envoyer"><app-pictogram picto="cross" [decorative]="true" /></button>
          <button type="button" class="yes" [disabled]="saving()" (click)="confirm()"><app-pictogram picto="check" [decorative]="true" /> Oui</button>
        </div>
      </app-sheet>
      <app-stamp [shown]="stamped()" />
    </div>
  `,
  styles: `
    :host { display: block; }
    .camera { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
    .trouble { display: block; margin-block-start: 10px; }
    .trouble p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .trouble app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
    .title { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 4px 0 10px; font: 700 1.4rem var(--font-hand); color: var(--color-earth); }
    .title app-pictogram { inline-size: 34px; block-size: 34px; }
    .viewfinder { display: block; inline-size: 100%; max-block-size: 50dvh; object-fit: contain; border: 3px solid var(--color-pasture); background: var(--color-pasture-light); }
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
export class PhotoGesture {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly reduce = inject(REDUCE_PHOTO);
  private readonly camera = viewChild.required<ElementRef<HTMLInputElement>>('camera');

  /** Where the photo is written: the site, the campaign and the day chosen in the notebook. */
  readonly target = input.required<DeclarationTarget>();

  protected readonly preview = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  protected readonly trouble = signal<Trouble | null>(null);
  protected readonly troubleWords: Record<Trouble, string> = {
    camera: 'L’appareil photo ne s’ouvre pas. Appelle le chef pour qu’il t’aide.',
    full: 'Le téléphone est plein de photos qui attendent le réseau. Va où il y a du réseau, puis recommence.',
    storage: 'Le téléphone n’arrive plus à garder tes déclarations. Appelle le chef.',
  };
  private bytes: Uint8Array | null = null;
  // The target as it stood when the camera opened: what the caretaker saw is where it is written.
  private openedOn: DeclarationTarget | null = null;

  protected open(): void {
    this.openedOn = this.target();
    this.trouble.set(null);
    void this.voice.say([clip('photo-take')]);
    this.camera().nativeElement.value = '';
    this.camera().nativeElement.click();
  }

  protected async taken(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    // The camera closed without a photo: nothing to say, nothing written.
    if (file === undefined) return;
    try {
      this.bytes = await this.reduce(file);
    } catch {
      this.say('camera');
      return;
    }
    this.preview.set(URL.createObjectURL(new Blob([this.bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })));
  }

  protected dismiss(): void {
    this.forget();
  }

  protected async confirm(): Promise<void> {
    const target = this.openedOn;
    const bytes = this.bytes;
    if (this.saving() || target === null || bytes === null) return;
    this.saving.set(true);
    try {
      const media = await this.sync.keepMedia(bytes, 'image/jpeg', 'OperationalProof');
      await this.sync.record({ ...target, recordedAt: this.clock.now().toISOString(), fact: { type: 'Photo', media } });
      this.forget();
      this.stamped.set(true);
      void this.voice.say([clip('photo-sent')]);
      setTimeout(() => this.stamped.set(false), STAMP_MS);
    } catch (error) {
      this.forget();
      this.say(error instanceof MediaQueueFull ? 'full' : 'storage');
    } finally {
      this.saving.set(false);
    }
  }

  private say(trouble: Trouble): void {
    this.trouble.set(trouble);
    void this.voice.say([clip(trouble === 'camera' ? 'photo-camera-refused' : trouble === 'full' ? 'photo-phone-full' : 'storage-full')]);
  }

  private forget(): void {
    const url = this.preview();
    if (url !== null) URL.revokeObjectURL(url);
    this.preview.set(null);
    this.bytes = null;
  }
}
