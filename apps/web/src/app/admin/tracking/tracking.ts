import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { TrackingView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { recall, remember } from '../office-sync';

/**
 * The « Suivi » of a lot at the office (V.3), as the server computes it. Read online; without
 * network, the last reading kept and its time (P.7).
 */
@Injectable()
export class Tracking {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly clock = inject(CLOCK);

  readonly view = signal<TrackingView | null>(null);
  readonly unreachable = signal(false);
  readonly readAt = signal<string | null>(null);

  async load(campaignId: string): Promise<void> {
    const session = this.auth.session();
    const userId = session.status === 'none' ? '' : session.userId;
    const headers = new HttpHeaders(session.status === 'none' ? {} : { Authorization: `Bearer ${session.token}` });
    const url = `/api/v1/campaigns/${campaignId}/tracking`;
    try {
      const view = await firstValueFrom(this.http.get<TrackingView>(url, { headers }));
      const at = this.clock.now();
      remember(userId, url, view, at);
      this.view.set(view);
      this.readAt.set(at.toISOString());
      this.unreachable.set(false);
    } catch {
      const kept = recall<TrackingView>(userId, url);
      this.view.set(kept?.value ?? null);
      this.readAt.set(kept?.readAt ?? null);
      this.unreachable.set(true);
    }
  }
}
