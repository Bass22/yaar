import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { OfficeEntry, OfficeEntryKind } from '../core/outbox/office-queue';
import { Pictogram } from '../ui/pictogram';
import { OfficeSync } from './office-sync';
import { amountWords, Purchases } from './purchases/purchases';

const WHAT: Record<OfficeEntryKind, string> = { cost: 'Dépense', payment: 'Paiement', settlement: 'Règlement', sale: 'Vente', saleReceipt: 'Encaissement' };
const WHY: Readonly<Record<string, string>> = {
  CampaignClosed: 'le lot est clos',
  UnknownCampaign: 'le lot n’existe plus',
  CostAlreadyExists: 'une autre dépense porte déjà cet identifiant',
  PaymentAlreadyExists: 'un autre paiement porte déjà cet identifiant',
  SettlementAlreadyExists: 'un autre règlement porte déjà cet identifiant',
  SaleAlreadyExists: 'une autre vente porte déjà cet identifiant',
  NotACustomer: 'l’acheteur n’est pas un client',
  CostTypeArchived: 'ce type n’est plus utilisé',
  CounterpartyArchived: 'ce tiers n’est plus disponible',
  NotFound: 'ce qu’il vise n’existe plus',
};

// What the office wrote and the server does not have yet (P.7): each entry with the clock, « en
// attente d'envoi »; a refused one with its reason and « J'ai vu ». Never lost in silence.
@Component({
  selector: 'app-office-pending',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown().length > 0) {
      <ul class="pending" aria-label="Pas encore reçu par le serveur">
        @for (entry of shown(); track entry.id) {
          <li [class.refused]="entry.state === 'refused'">
            <app-pictogram [picto]="entry.state === 'refused' ? 'cross' : 'stamp-pending'" [decorative]="true" />
            <span class="words">
              <b>{{ what(entry) }}</b>&ngsp;<small>{{ entry.state === 'refused' ? 'refusé : ' + why(entry) : 'en attente d’envoi' }}</small>
            </span>
            @if (entry.state === 'refused') {
              <button type="button" class="seen" (click)="sync.dismiss(entry.id)">J’ai vu</button>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; }
    .pending { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 8px; }
    li { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 2px dashed var(--color-orange); border-radius: 4px; background: var(--color-orange-light); color: var(--color-earth); }
    li.refused { border-color: var(--color-alert); background: var(--color-alert-light); }
    li app-pictogram { inline-size: 30px; block-size: 30px; flex: none; }
    .words { flex: 1; display: grid; }
    .words b { font: 700 1rem var(--font-hand); }
    .refused .words small { color: var(--color-alert); font-weight: 700; }
    .seen { min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); font-weight: 700; cursor: pointer; }
    .seen:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class OfficePending {
  protected readonly sync = inject(OfficeSync);
  private readonly purchases = inject(Purchases);

  readonly kinds = input.required<readonly OfficeEntryKind[]>();
  /** Only the entries of this lot, order or counterparty; all of them when absent. */
  readonly subject = input<string | null>(null);

  protected readonly shown = computed(() => this.sync.entries().filter((entry) => this.kinds().includes(entry.kind) && (this.subject() === null || entry.subject === this.subject())));

  protected what(entry: OfficeEntry): string {
    const birds = entry.body['birds'];
    if (entry.kind === 'sale' && typeof birds === 'number') return `Vente de ${birds} poulet${birds > 1 ? 's' : ''}`;
    const amount = typeof entry.body['amount'] === 'number' ? entry.body['amount'] : 0;
    return `${WHAT[entry.kind]} de ${amountWords(amount, this.purchases.currency() ?? '')}`;
  }

  protected why(entry: OfficeEntry): string {
    return WHY[entry.refusal ?? ''] ?? 'le serveur l’a refusé';
  }
}
