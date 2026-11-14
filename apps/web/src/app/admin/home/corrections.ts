import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CorrectionToReview } from '@contracts';
import { AuthService } from '../../core/session/auth';
import { authHeaders } from '../../core/session/auth-headers';

/** The corrections caretakers wrote, waiting for an admin's « Vu » (Y.2b). Read and written online. */
@Injectable({ providedIn: 'root' })
export class Corrections {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly toReview = signal<readonly CorrectionToReview[]>([]);

  async load(): Promise<void> {
    try {
      this.toReview.set(await firstValueFrom(this.http.get<CorrectionToReview[]>('/api/v1/corrections/to-review', { headers: this.headers() })));
    } catch {
      // Offline: the cards last read stay.
    }
  }

  /** « Vu »: the card goes once the server kept it; without network, it stays. */
  async review(correctionId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`/api/v1/corrections/${correctionId}/review`, null, { headers: this.headers() }));
    } catch {
      return;
    }
    await this.load();
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}
