import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, Injectable, inject, input, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { AttachRequest } from '@contracts';
import { REDUCE_PHOTO } from '../core/media/reduce-photo';
import { fingerprintOf } from '../core/outbox/media-queue';
import { AuthService } from '../core/session/auth';
import { Pictogram } from '../ui/pictogram';
import { authHeaders } from '../core/session/auth-headers';

/** The supporting photos of the office (R.6): sent, joined, read — online. */
@Injectable({ providedIn: 'root' })
export class Photos {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** Sends the photo to the media store, then joins it: the entry it is joined to never changes. */
  async join(bytes: Uint8Array, subjectKind: AttachRequest['subjectKind'], subjectId: string): Promise<boolean> {
    try {
      const media = await fingerprintOf(bytes);
      await firstValueFrom(
        this.http.put(`/api/v1/media/${media}`, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), {
          params: { retention: 'SupportingDocument' },
          headers: this.headers().set('Content-Type', 'image/jpeg'),
        }),
      );
      const request: AttachRequest = { id: crypto.randomUUID(), subjectKind, subjectId, media };
      await firstValueFrom(this.http.post('/api/v1/attachments', request, { headers: this.headers() }));
      return true;
    } catch {
      return false;
    }
  }

  /** The photo as an address the page can show, `null` when it cannot be read. */
  async open(media: string): Promise<string | null> {
    try {
      const blob = await firstValueFrom(this.http.get(`/api/v1/media/${media}`, { headers: this.headers(), responseType: 'blob' }));
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}

// The photos of an entry (R.6): each one opens with a tap; « Joindre une photo » adds one — at the
// time or later — when the entry can take one.
@Component({
  selector: 'app-photos',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="photos">
      @for (media of photos(); track media; let index = $index) {
        <button type="button" class="photo" (click)="show(media)"><app-pictogram picto="camera" [decorative]="true" /> {{ label() }}{{ photos().length > 1 ? ' ' + (index + 1) : '' }}</button>
      }
      @if (subject(); as entry) {
        <label class="attach">
          <app-pictogram picto="camera" [decorative]="true" /> {{ busy() ? 'Envoi…' : 'Joindre une photo' }}
          <input type="file" accept="image/*" capture="environment" [disabled]="busy()" (change)="take($event, entry)" />
        </label>
      }
      @if (problem(); as said) {
        <span class="problem" role="alert">{{ said }}</span>
      }
    </span>
    @if (viewing(); as url) {
      <div class="photo-viewer" role="dialog" aria-label="Le justificatif">
        <img [src]="url" alt="Le justificatif" />
        <button type="button" class="close" (click)="close()">Fermer</button>
      </div>
    }
  `,
  styles: `
    .photos { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .photo, .attach { position: relative; display: inline-flex; align-items: center; gap: 6px; min-block-size: 44px; padding: 0 10px; border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .photo app-pictogram, .attach app-pictogram { inline-size: 22px; block-size: 22px; }
    .attach input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .problem { color: var(--color-alert); font-weight: 700; }
    .photo-viewer { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; gap: 10px; padding: 16px; background: var(--color-ink); }
    .photo-viewer img { max-inline-size: 100%; max-block-size: 80vh; object-fit: contain; }
    .photo-viewer .close { min-block-size: 48px; padding: 0 18px; border: 2px solid var(--color-paper); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; }
    .photo:focus-visible, .attach:has(input:focus-visible), .close:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class PhotosComponent {
  private readonly service = inject(Photos);
  private readonly reduce = inject(REDUCE_PHOTO);

  readonly photos = input.required<readonly string[]>();
  /** What a new photo joins; absent, nothing can be joined here. */
  readonly subject = input<{ readonly kind: AttachRequest['subjectKind']; readonly id: string } | null>(null);
  readonly label = input('Photo');
  /** A photo was joined: the entry is to be read again. */
  readonly joined = output<void>();

  protected readonly viewing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected async show(media: string): Promise<void> {
    const url = await this.service.open(media);
    if (url === null) return this.problem.set('La photo ne s’ouvre pas : vérifie le réseau.');
    this.problem.set(null);
    this.viewing.set(url);
  }

  protected close(): void {
    const url = this.viewing();
    if (url !== null) URL.revokeObjectURL(url);
    this.viewing.set(null);
  }

  protected async take(event: Event, entry: { readonly kind: AttachRequest['subjectKind']; readonly id: string }): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    this.busy.set(true);
    try {
      const joined = await this.service.join(await this.reduce(file), entry.kind, entry.id);
      this.problem.set(joined ? null : 'La photo n’est pas partie : joindre une photo demande le réseau. Réessaie.');
      if (joined) this.joined.emit();
    } catch {
      this.problem.set('Cette photo ne se lit pas. Reprends-la.');
    } finally {
      this.busy.set(false);
    }
  }
}
