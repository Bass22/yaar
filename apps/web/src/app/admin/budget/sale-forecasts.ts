import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { RecordSaleForecastRequest, SaleForecastsView, SaleForecastView } from '@contracts';
import { AuthService } from '../../core/session/auth';

import { amountWords, Purchases } from '../purchases/purchases';
import { dayWords, grouped, typedNumber, typedText } from '../typed-number';
import { authHeaders } from '../../core/session/auth-headers';

/** Grams as kilos are said: 2 200 g → « 2,2 ». */
const kilos = (grams: number): string => String(grams / 1000).replace('.', ',');

// The planned sales of a flock (W.4; decisions of 2026-11-13): buyer by buyer, by the bird or by the
// kilo — at an average weight, then required; each one says what it brings, then the plan against the
// budget, and what was really sold. A plan, never a receivable. Written online; each writing kept.
@Component({
  selector: 'app-sale-forecasts',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sale-forecasts" aria-label="Les ventes prévues">
      <h2>Ventes prévues</h2>
      @if (view(); as view) {
        @for (forecast of view.forecasts; track forecast.forecastId) {
          <div class="forecast" [attr.data-id]="forecast.forecastId">
            <p class="what">{{ words(forecast, view.currency) }}</p>
            @if (!view.closed) {
              <button type="button" class="withdraw" (click)="withdraw(forecast.forecastId)">Retirer</button>
            }
          </div>
        } @empty {
          <p class="hint">Aucune vente prévue pour l’instant.</p>
        }
        <div class="forecast-totals">
          <p class="total">Recettes prévues&ngsp;<b>{{ money(view.expectedRevenue, view.currency) }}</b></p>
          <p class="total">Budget&ngsp;<b>{{ view.budget === null ? '—' : money(view.budget, view.currency) }}</b></p>
          <p class="total" [class.negative]="(view.expectedMargin ?? 0) < 0">Marge prévue&ngsp;<b>{{ view.expectedMargin === null ? '—' : signed(view.expectedMargin, view.currency) }}</b></p>
          <p class="total">Réalisé&ngsp;<b>{{ money(view.realized, view.currency) }}</b></p>
        </div>
        @if (!view.closed) {
          @if (writing()) {
            <form class="forecast-form" (submit)="write($event)">
              <div class="buyers" role="radiogroup" aria-label="L’acheteur">
                @for (buyer of buyers(); track buyer.id) {
                  <label class="chip"><input type="radio" name="buyer" [value]="buyer.id" [checked]="buyerId() === buyer.id" (change)="buyerId.set(buyer.id)" />{{ buyer.name }}</label>
                }
              </div>
              <label class="field"><span>La semaine</span><input name="week" type="date" [value]="week()" (input)="week.set(valueOf($event))" /></label>
              <label class="field"><span>Combien de poulets ?</span><input name="birds" type="text" inputmode="numeric" [value]="grouped(birds())" (input)="birds.set(typedNumber($event))" /></label>
              <div class="pricing" role="radiogroup" aria-label="Le prix">
                <label class="chip"><input type="radio" name="pricing" value="PerBird" [checked]="pricing() === 'PerBird'" (change)="pricing.set('PerBird')" />Par tête</label>
                <label class="chip"><input type="radio" name="pricing" value="PerKilo" [checked]="pricing() === 'PerKilo'" (change)="pricing.set('PerKilo')" />Au kilo</label>
              </div>
              <label class="field"><span>{{ pricing() === 'PerBird' ? 'Prix d’un poulet' : 'Prix du kilo' }}</span><input name="price" type="text" inputmode="numeric" [value]="grouped(price())" (input)="price.set(typedNumber($event))" /></label>
              <label class="field"><span>{{ pricing() === 'PerKilo' ? 'Poids moyen prévu (kg)' : 'Poids moyen prévu (kg), pour info' }}</span><input name="weight" type="text" inputmode="decimal" [value]="weight()" (input)="weight.set(valueOf($event))" /></label>
              @if (problem(); as said) {
                <p class="refusal" role="alert">{{ said }}</p>
              }
              <div class="actions">
                <button type="submit" class="write">Prévoir cette vente</button>
                <button type="button" class="cancel" (click)="writing.set(false)">Fermer</button>
              </div>
            </form>
          } @else {
            <button type="button" class="add-forecast" (click)="writing.set(true)">Prévoir une vente</button>
          }
        }
      }
    </section>
  `,
  styles: `
    :host { display: block; margin-block-start: 18px; }
    h2 { margin: 0 0 8px; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    .forecast { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px; padding: 8px 10px; margin-block-end: 6px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); }
    .what { margin: 0; color: var(--color-ink); font-variant-numeric: tabular-nums; }
    .hint { color: var(--color-muted); }
    .forecast-totals { display: grid; gap: 2px; margin: 10px 0; }
    .total { margin: 0; display: flex; justify-content: space-between; gap: 8px; color: var(--color-ink); }
    .total.negative b { color: var(--color-alert); }
    button { min-block-size: 44px; padding: 0 14px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .add-forecast, .write { background: var(--color-pasture); color: var(--color-on-sign); }
    .forecast-form { display: grid; gap: 10px; padding: 12px; background: var(--color-shell); border: 2px dashed var(--color-card-edge); border-radius: 4px; }
    .buyers, .pricing, .actions { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { position: relative; display: inline-flex; align-items: center; min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .chip input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .chip:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture); color: var(--color-on-sign); }
    .field { display: grid; gap: 4px; font-weight: 700; color: var(--color-ink); }
    .field input { min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); }
    .refusal { margin: 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    button:focus-visible, .field input:focus-visible, .chip:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class SaleForecasts {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly purchases = inject(Purchases);

  readonly campaignId = input.required<string>();
  protected readonly view = signal<SaleForecastsView | null>(null);
  protected readonly buyers = this.purchases.customers;
  protected readonly grouped = grouped;
  protected readonly typedNumber = typedNumber;

  protected readonly writing = signal(false);
  protected readonly buyerId = signal('');
  protected readonly week = signal('');
  protected readonly birds = signal('');
  protected readonly pricing = signal<'PerBird' | 'PerKilo'>('PerBird');
  protected readonly price = signal('');
  protected readonly weight = signal('');
  protected readonly problem = signal<string | null>(null);
  private readonly url = computed(() => `/api/v1/campaigns/${this.campaignId()}/sale-forecasts`);

  constructor() {
    void this.purchases.load();
    effect(() => {
      this.url();
      untracked(() => void this.load());
    });
  }

  protected words(forecast: SaleForecastView, currency: string): string {
    const who = this.purchases.counterpartyById().get(forecast.buyerId)?.name ?? '';
    const birds = `${grouped(forecast.birds)} poulet${forecast.birds > 1 ? 's' : ''}`;
    const total = this.money(forecast.expectedRevenue, currency);
    if (forecast.pricing.kind === 'PerKilo') {
      return `${who} · ${dayWords(forecast.week)} · ${birds} × ${kilos(forecast.averageWeight ?? 0)} kg × ${this.money(forecast.pricing.price, currency)} le kilo = ${total}`;
    }
    const weight = forecast.averageWeight === null ? '' : ` · ${kilos(forecast.averageWeight)} kg prévus`;
    return `${who} · ${dayWords(forecast.week)} · ${birds} × ${this.money(forecast.pricing.price, currency)} = ${total}${weight}`;
  }

  protected money(amount: number, currency: string): string {
    return amountWords(amount, currency);
  }

  protected signed(amount: number, currency: string): string {
    return amount < 0 ? `−${this.money(-amount, currency)}` : `+${this.money(amount, currency)}`;
  }

  protected valueOf(event: Event): string {
    return typedText(event);
  }

  protected async write(event: Event): Promise<void> {
    event.preventDefault();
    const typed = this.weight().trim().replace(',', '.');
    const grams = typed === '' ? null : Math.round(Number(typed) * 1000);
    if (grams !== null && !Number.isFinite(grams)) return this.problem.set('Le poids moyen s’écrit en kilos, par exemple 2,2.');
    const request: RecordSaleForecastRequest = {
      id: crypto.randomUUID(),
      buyerId: this.buyerId(),
      week: this.week(),
      birds: Number(this.birds()),
      pricing: { kind: this.pricing(), price: Number(this.price()) },
      averageWeight: grams,
    };
    const refused = await this.send('PUT', `${this.url()}/${crypto.randomUUID()}`, request);
    if (refused !== null) return this.problem.set(refused);
    this.problem.set(null);
    this.writing.set(false);
    await this.load();
  }

  protected async withdraw(forecastId: string): Promise<void> {
    const refused = await this.send('POST', `${this.url()}/${forecastId}/withdraw`, { id: crypto.randomUUID() });
    if (refused === null) await this.load();
  }

  private async load(): Promise<void> {
    try {
      this.view.set(await firstValueFrom(this.http.get<SaleForecastsView>(this.url(), { headers: this.headers() })));
    } catch {
      this.view.set(null);
    }
  }

  private async send(method: 'PUT' | 'POST', url: string, body: unknown): Promise<string | null> {
    try {
      await firstValueFrom(this.http.request(method, url, { body, headers: this.headers() }));
      return null;
    } catch {
      return 'La vente prévue n’a pas été écrite : vérifie l’acheteur, la semaine, les poulets, le prix — et le poids, au kilo.';
    }
  }

  private headers(): HttpHeaders {
    const session = this.auth.session();
    return authHeaders(session);
  }
}
