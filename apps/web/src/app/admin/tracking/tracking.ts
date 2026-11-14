import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { TrackingView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { readOrRecall } from '../office-sync';
import { authHeaders } from '../../core/session/auth-headers';

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
    const headers = authHeaders(session);
    const url = `/api/v1/campaigns/${campaignId}/tracking`;
    await readOrRecall<TrackingView>(this.http, url, userId, headers, () => this.clock.now(), (reading, online) => {
      this.view.set(reading?.value ?? null);
      this.readAt.set(reading?.readAt ?? null);
      this.unreachable.set(!online);
    });
  }
}
