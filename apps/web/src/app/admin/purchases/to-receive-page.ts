import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ReceptionView } from '@contracts';
import { Pictogram } from '../../ui/pictogram';

import { Purchases } from './purchases';
import { leftWords, RECEPTION_STATE, Receptions } from './receptions';
import { dayWords } from '../typed-number';

const ORDER: Readonly<Record<ReceptionView['state'], number>> = { Late: 0, Today: 1, Coming: 2, Received: 3 };

// « À recevoir » (Q.14): the planned receptions not yet received, late first — in the colour of
// alarm —, then today, then coming. Each one leads to its order.
@Component({
  selector: 'app-to-receive-page',
  imports: [Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="truck" [decorative]="true" /> À recevoir</h1>
    <a class="back" routerLink="..">Revenir aux achats</a>
    @for (reception of waiting(); track reception.receptionId) {
      <div [class]="'to-receive ' + state(reception).tone">
        <a [routerLink]="['..', reception.orderId, 'fiche']">
          <b>{{ supplierName(reception.supplierId) }}</b> · {{ day(reception.plannedOn) }} · <span class="state">{{ state(reception).words }}</span>
          <span class="left">{{ left(reception) }}</span>
        </a>
      </div>
    } @empty {
      <p class="hint">Rien à recevoir de prévu.</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 32px; block-size: 32px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    .hint { color: var(--color-muted); }
    .to-receive { margin-block-end: 8px; border: 2px solid var(--color-card-edge); border-inline-start-width: 6px; border-radius: 4px; background: var(--color-shell); }
    .to-receive a { display: grid; gap: 2px; min-block-size: 48px; padding: 8px 10px; color: var(--color-ink); text-decoration: none; }
    .to-receive.late { border-inline-start-color: var(--color-alert); }
    .to-receive.late .state { color: var(--color-alert); font-weight: 700; }
    .to-receive.today { border-inline-start-color: var(--color-orange); }
    .to-receive.coming { border-inline-start-color: var(--color-neutral); }
    .left { color: var(--color-muted); }
    a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ToReceivePage {
  private readonly purchases = inject(Purchases);
  private readonly receptions = inject(Receptions);

  protected readonly waiting = computed(() =>
    (this.receptions.view()?.receptions ?? []).filter(({ state }) => state !== 'Received').sort((a, b) => ORDER[a.state] - ORDER[b.state] || (a.plannedOn < b.plannedOn ? -1 : 1)),
  );

  constructor() {
    void this.purchases.load();
    void this.receptions.load();
  }

  protected state(reception: ReceptionView) {
    return RECEPTION_STATE[reception.state];
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
