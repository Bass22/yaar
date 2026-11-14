import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { DeathPhotosView } from '@contracts';
import { AuthService } from '../../core/session/auth';
import { Pictogram } from '../../ui/pictogram';
import { authHeaders } from '../../core/session/auth-headers';

// For a lot, how each caretaker answered for the dead (K.6; CdC « Photo des morts »): how many of
// its death declarations were photographed, of those answered; those without an answer — written
// before K.6, or by an admin — apart, never counted as « no photo ». Read online: nothing is kept.
@Component({
  selector: 'app-death-photos',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="death-photos" aria-label="Les morts en photo">
      <h2><app-pictogram picto="camera" [decorative]="true" /> Les morts en photo</h2>
      @if (view(); as view) {
        @if (view.caretakers.length === 0) {
          <p class="none">Aucun mort déclaré pour ce lot.</p>
        } @else {
          <ul>
            @for (one of view.caretakers; track one.authorId) {
              <li [class.low]="one.photographed < one.photographed + one.noPhoto">
                <b>{{ one.name }}</b>&ngsp;<span>{{ one.photographed }} sur {{ one.photographed + one.noPhoto }} en photo{{ one.unanswered > 0 ? ' · ' + one.unanswered + ' sans réponse' : '' }}</span>
              </li>
            }
          </ul>
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; margin-block-start: 16px; }
    h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font: 700 1.1rem var(--font-hand); color: var(--color-earth); }
    h2 app-pictogram { inline-size: 26px; block-size: 26px; }
    ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    li { display: flex; justify-content: space-between; gap: 10px; padding: 6px 4px; border-block-end: 1px solid var(--color-rule); color: var(--color-earth); }
    li.low span { color: var(--color-orange); font-weight: 700; }
    .none { margin: 0; color: var(--color-muted); font-style: italic; }
  `,
})
export class DeathPhotos {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly campaignId = input.required<string>();
  protected readonly view = signal<DeathPhotosView | null>(null);

  constructor() {
    effect(() => {
      const campaignId = this.campaignId();
      untracked(() => void this.load(campaignId));
    });
  }

  private async load(campaignId: string): Promise<void> {
    const session = this.auth.session();
    try {
      this.view.set(await firstValueFrom(this.http.get<DeathPhotosView>(`/api/v1/campaigns/${campaignId}/death-photos`, { headers: authHeaders(session) })));
    } catch {
      this.view.set(null);
    }
  }
}
