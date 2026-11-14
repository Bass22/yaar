import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { CostTypeView, PlanReceptionRequest, ReceptionsView, ReceptionStateCode, ReceptionView } from '@contracts';
import { grouped } from '../typed-number';
import { AuthService } from '../../core/session/auth';
import { authHeaders } from '../../core/session/auth-headers';
import { byTheBag } from '@domain/journal';

/** What each state is called (Q.14): picto, colour and word go together on the screen. */
export const RECEPTION_STATE: Readonly<Record<ReceptionStateCode, { readonly tone: string; readonly words: string }>> = {
  Late: { tone: 'late', words: 'En retard' },
  Today: { tone: 'today', words: 'Aujourd’hui' },
  Coming: { tone: 'coming', words: 'À venir' },
  Received: { tone: 'received', words: 'Reçue' },
};

/** « 4 sacs Aliment démarrage, 10 sacs Copeaux »: what a planned reception still waits for. */
export function leftWords(reception: ReceptionView, typeOf: ReadonlyMap<string, CostTypeView>): string {
  return reception.lines
    .filter(({ remaining }) => remaining > 0)
    .map(({ remaining, costTypeId }) => {
      const type = typeOf.get(costTypeId);
      const unit = byTheBag(type?.category ?? '') ? (remaining > 1 ? 'sacs' : 'sac') : type?.category === 'Chicks' ? 'poussins' : 'unités';
      return `${grouped(remaining)} ${unit} ${type?.name ?? ''}`;
    })
    .join(', ');
}

/** The planned receptions of the open orders (Q.14), read and written online. */
@Injectable({ providedIn: 'root' })
export class Receptions {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly view = signal<ReceptionsView | null>(null);

  async load(): Promise<void> {
    try {
      this.view.set(await firstValueFrom(this.http.get<ReceptionsView>('/api/v1/receptions', { headers: this.headers() })));
    } catch {
      this.view.set(null);
    }
  }

  /** A writing of a planned reception: a new one, or the same with a new day — rescheduled. */
  async plan(orderId: string, receptionId: string, plannedOn: string, lines: PlanReceptionRequest['lines']): Promise<boolean> {
    const request: PlanReceptionRequest = { id: crypto.randomUUID(), plannedOn, lines };
    return this.send('PUT', `/api/v1/orders/${orderId}/receptions/${receptionId}`, request);
  }

  async withdraw(orderId: string, receptionId: string): Promise<boolean> {
    return this.send('POST', `/api/v1/orders/${orderId}/receptions/${receptionId}/withdraw`, { id: crypto.randomUUID() });
  }

  private async send(method: 'PUT' | 'POST', url: string, body: unknown): Promise<boolean> {
    try {
      await firstValueFrom(this.http.request(method, url, { body, headers: this.headers() }));
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}
