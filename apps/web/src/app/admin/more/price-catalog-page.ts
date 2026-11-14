import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/session/auth';
import { Affixed } from '../../ui/affixed';
import { Pictogram } from '../../ui/pictogram';
import { Purchases, amountWords } from '../purchases/purchases';
import { currencyWord, grouped, typedNumber } from '../typed-number';
import { authHeaders } from '../../core/session/auth-headers';

// « Prix habituels » (N.5): what an order proposes for each article — learned from the orders,
// or set here by hand, for every supplier. A proposal only: an order says the price it pays.
@Component({
  selector: 'app-price-catalog-page',
  imports: [Affixed, Pictogram, RouterLink],
  providers: [Purchases],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="coin" [decorative]="true" /> Prix habituels</h1>
    <a class="back" routerLink="..">Revenir aux réglages</a>
    <p class="hint">Ce qu'une commande propose pour chaque article : le dernier prix payé, ou celui que tu fixes ici. Une commande peut toujours dire un autre prix.</p>
    @for (type of purchases.orderableTypes(); track type.id) {
      <div class="article" [attr.data-type]="type.id">
        <span class="name">{{ type.name }}</span>
        <span class="known">{{ known(type.id) }}</span>
        <app-affixed [unit]="currency()"><input class="price" type="text" inputmode="numeric" autocomplete="off" [attr.aria-label]="'Nouveau prix : ' + type.name" [value]="grouped(typed(type.id))" (input)="typePrice(type.id, $event)" /></app-affixed>
        <button type="button" class="set" [disabled]="!valid(type.id)" (click)="set(type.id)">Fixer</button>
      </div>
    } @empty {
      <p class="hint">Aucun article à commander.</p>
    }
    @if (problem(); as said) {
      <p class="refusal" role="alert">{{ said }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .hint { margin: 0 0 8px; color: var(--color-muted); font-size: 0.9rem; }
    .article { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 10px; align-items: center; padding: 10px 12px; margin-block-start: 8px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .name { font-weight: 700; color: var(--color-ink); }
    .known { justify-self: end; color: var(--color-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .price { min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums; }
    .set { min-block-size: 44px; padding: 0 14px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700; cursor: pointer; }
    .set:disabled { opacity: 0.5; cursor: not-allowed; }
    .refusal { margin: 10px 0 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    a:focus-visible, button:focus-visible, .price:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class PriceCatalogPage {
  protected readonly purchases = inject(Purchases);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly drafts = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly problem = signal<string | null>(null);
  protected readonly currency = computed(() => currencyWord(this.purchases.currency()));
  protected readonly grouped = grouped;

  constructor() {
    void this.purchases.load();
    void this.purchases.loadPriceCatalog();
  }

  /** What an order proposes today for the article, from any supplier. */
  protected known(costTypeId: string): string {
    const price = this.purchases.proposedPrice(costTypeId, '');
    return price === '' ? 'pas encore de prix' : `proposé : ${amountWords(Number(price), this.purchases.currency() ?? '')}`;
  }

  protected typed(costTypeId: string): string {
    return this.drafts().get(costTypeId) ?? '';
  }

  protected typePrice(costTypeId: string, event: Event): void {
    const value = typedNumber(event);
    this.drafts.update((drafts) => new Map(drafts).set(costTypeId, value));
  }

  protected valid(costTypeId: string): boolean {
    return /^\d+$/.test(this.typed(costTypeId));
  }

  protected async set(costTypeId: string): Promise<void> {
    const session = this.auth.session();
    const headers = authHeaders(session);
    try {
      await firstValueFrom(this.http.post('/api/v1/price-catalog', { id: crypto.randomUUID(), costTypeId, supplierId: null, unitPrice: Number(this.typed(costTypeId)) }, { headers }));
      this.problem.set(null);
      this.drafts.update((drafts) => {
        const next = new Map(drafts);
        next.delete(costTypeId);
        return next;
      });
      await this.purchases.loadPriceCatalog();
    } catch {
      this.problem.set('Le prix n’a pas été fixé : vérifie le réseau, puis réessaie.');
    }
  }
}
