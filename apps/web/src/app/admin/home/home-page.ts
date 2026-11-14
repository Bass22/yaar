import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ReceptionView } from '@contracts';
import { Pictogram } from '../../ui/pictogram';

import { FiguresAge } from '../figures-age';
import { LotList } from '../lots/lot-list';
import { Office } from '../office';
import { Purchases } from '../purchases/purchases';
import { leftWords, Receptions } from '../purchases/receptions';
import { Corrections } from './corrections';
import { dayWords } from '../typed-number';

// The office's home (bureau-admin-v2.html): one line per running lot, then what waits for the
// chef, the most urgent first. A planned reception gone late waits for him (Q.14): it leads to its
// order, where its day is rescheduled. Refusals and alerts of O.4, and the inbox of U, come later.
@Component({
  selector: 'app-home-page',
  imports: [FiguresAge, LotList, Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!office.unreachable()) {
      <app-figures-age [readAt]="office.readAt()?.at ?? null" />
    }
    <app-lot-list [lots]="office.lots()" />
    <h1><app-pictogram picto="bell" [decorative]="true" /> À traiter</h1>
    @if (late().length > 0 || corrections.toReview().length > 0 || tooManyDeaths().length > 0) {
      <ul class="todo">
        <!-- Deaths beyond the living (Y.2b): as long as the count stays below zero, signed (rule 9) -->
        @for (lot of tooManyDeaths(); track lot.campaignId) {
          <li class="too-many-deaths">
            <a routerLink="/admin/lots/journal" [queryParams]="{ lot: lot.campaignId }">
              <app-pictogram picto="dead-chicken" [decorative]="true" />
              <span><b>Plus de morts que de vivants</b> : {{ lot.siteName }}, J{{ lot.campaignDay }} — vivants {{ signed(lot.liveCount) }}</span>
            </a>
          </li>
        }
        <!-- A correction a caretaker wrote waits for « Vu » (Y.2b; founder's decision of 2026-11-14) -->
        @for (correction of corrections.toReview(); track correction.correctionId) {
          <li class="correction">
            <a routerLink="/admin/lots/journal" [queryParams]="{ lot: correction.campaignId }">
              <app-pictogram picto="pencil" [decorative]="true" />
              <span><b>Correction</b> : {{ correction.siteName }}, J{{ correction.campaignDay }} — {{ correction.before }} → {{ correction.after }}, par {{ correction.authorName }}</span>
            </a>
            <button type="button" class="seen" (click)="corrections.review(correction.correctionId)">Vu</button>
          </li>
        }
        @for (reception of late(); track reception.receptionId) {
          <li class="late-reception">
            <a [routerLink]="['/admin/achats', reception.orderId, 'fiche']">
              <app-pictogram picto="truck" [decorative]="true" />
              <span><b>Réception en retard</b> : {{ supplierName(reception.supplierId) }}, prévue le {{ day(reception.plannedOn) }} — {{ left(reception) }}</span>
            </a>
          </li>
        }
      </ul>
    } @else {
      <p class="nothing"><app-pictogram picto="round-check" [decorative]="true" /> Rien à traiter pour l’instant.</p>
    }
  `,
  styles: `
    h1 { display: flex; align-items: center; gap: 8px; margin: 16px 0 6px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 28px; block-size: 28px; }
    .nothing { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--color-muted); font-style: italic; }
    .nothing app-pictogram { inline-size: 30px; block-size: 30px; }
    .todo { list-style: none; margin: 0; padding: 0; }
    .late-reception a { display: flex; align-items: center; gap: 10px; min-block-size: 48px; padding: 8px 10px; margin-block-end: 6px; border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-alert); border-radius: 4px; background: var(--color-orange-light); color: var(--color-ink); text-decoration: none; }
    .late-reception app-pictogram, .too-many-deaths app-pictogram, .correction app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .too-many-deaths a { display: flex; align-items: center; gap: 10px; min-block-size: 48px; padding: 8px 10px; margin-block-end: 6px; border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-alert); border-radius: 4px; background: var(--color-alert-light); color: var(--color-ink); text-decoration: none; }
    .correction { display: flex; align-items: center; gap: 8px; margin-block-end: 6px; padding: 6px 8px; border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-orange); border-radius: 4px; background: var(--color-shell); }
    .correction a { display: flex; align-items: center; gap: 10px; flex: 1; min-inline-size: 0; min-block-size: 44px; color: var(--color-ink); text-decoration: none; }
    .seen { flex: none; min-block-size: 44px; min-inline-size: 56px; padding: 0 12px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .seen:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class HomePage {
  protected readonly office = inject(Office);
  private readonly purchases = inject(Purchases);
  private readonly receptions = inject(Receptions);

  protected readonly corrections = inject(Corrections);

  protected readonly late = computed(() => (this.receptions.view()?.receptions ?? []).filter(({ state }) => state === 'Late'));
  protected readonly tooManyDeaths = computed(() => this.office.lots().flatMap((lot) => (lot.liveCount !== null && lot.liveCount < 0 ? [{ ...lot, liveCount: lot.liveCount }] : [])));

  constructor() {
    void this.purchases.load();
    void this.receptions.load();
    void this.corrections.load();
  }

  /** « −2 »: a count below zero keeps its sign. */
  protected signed(value: number): string {
    return value < 0 ? `\u2212${-value}` : String(value);
  }

  protected day(day: string): string {
    return dayWords(day);
  }

  protected supplierName(id: string): string {
    return this.purchases.counterpartyById().get(id)?.name ?? '';
  }

  protected left(reception: ReceptionView): string {
    return leftWords(reception, this.purchases.costTypeById());
  }
}
