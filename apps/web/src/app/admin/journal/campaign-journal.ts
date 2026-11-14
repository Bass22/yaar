import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { CampaignJournalView } from '@contracts';
import { CLOCK } from '../../core/clock';
import { AuthService } from '../../core/session/auth';
import { readOrRecall } from '../office-sync';
import { authHeaders } from '../../core/session/auth-headers';

/**
 * The journal of a campaign at the office (O.7), as the server reads it. Online; without network,
 * the last reading kept and its time (P.7).
 */
@Injectable()
export class CampaignJournal {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly clock = inject(CLOCK);

  readonly view = signal<CampaignJournalView | null>(null);
  readonly unreachable = signal(false);
  readonly readAt = signal<string | null>(null);

  async load(campaignId: string): Promise<void> {
    const session = this.auth.session();
    const userId = session.status === 'none' ? '' : session.userId;
    const headers = authHeaders(session);
    const url = `/api/v1/campaigns/${campaignId}/journal`;
    await readOrRecall<CampaignJournalView>(this.http, url, userId, headers, () => this.clock.now(), (reading, online) => {
      this.view.set(reading?.value ?? null);
      this.readAt.set(reading?.readAt ?? null);
      this.unreachable.set(!online);
    });
  }
}
