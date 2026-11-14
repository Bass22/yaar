import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, input, signal } from '@angular/core';
import type { OrderView, ReceptionView } from '@contracts';

import { dayWords, grouped, typedNumber, typedText } from '../typed-number';
import { Purchases } from './purchases';
import { RECEPTION_STATE, Receptions } from './receptions';

// The planned receptions of an order received in several times (Q.14; decisions of 2026-11-13): an
// order received in one go needs none — the caretaker is told, that is all. Each one says its day
// (and the day before, when rescheduled), its state, what came and what is left; a late one is
// rescheduled with « Changer la date ».
@Component({
  selector: 'app-order-receptions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="receptions" aria-label="Les réceptions prévues">
      <h2>Réceptions prévues</h2>
      @for (reception of mine(); track reception.receptionId) {
        <div class="reception" [attr.data-id]="reception.receptionId" [class]="'reception ' + state(reception).tone">
          <p class="when">
            <b>{{ day(reception.plannedOn) }}</b>
            @if (reception.previousDates.length > 0) {
              &ngsp;<small>(prévue d’abord le {{ day(reception.previousDates[0]!) }})</small>
            }
            &ngsp;<span class="state">{{ state(reception).words }}</span>
          </p>
          @for (line of reception.lines; track line.orderLineId) {
            <p class="line-progress">{{ typeName(line.costTypeId) }} {{ grouped(line.received) }} / {{ grouped(line.expected) }} reçus, reste {{ grouped(line.remaining) }}</p>
          }
          @if (rescheduling() === reception.receptionId) {
            <div class="reschedule-form">
              <input name="newDate" type="date" [value]="newDate()" (input)="newDate.set(valueOf($event))" aria-label="La nouvelle date" />
              <button type="button" class="save-date" (click)="reschedule(reception)">Enregistrer</button>
              <button type="button" class="cancel" (click)="rescheduling.set(null)">Fermer</button>
            </div>
          } @else if (reception.state !== 'Received') {
            <div class="actions">
              <button type="button" class="reschedule" (click)="openReschedule(reception)">Changer la date</button>
              <button type="button" class="withdraw" (click)="withdraw(reception)">Retirer</button>
            </div>
          }
        </div>
      }
      @if (planning()) {
        <form class="reception-form" (submit)="plan($event)">
          <label class="field"><span>Le jour prévu</span><input name="plannedOn" type="date" [value]="plannedOn()" (input)="plannedOn.set(valueOf($event))" /></label>
          @for (line of order().lines; track line.id) {
            <label class="field"><span>{{ typeName(line.costTypeId) }}</span><input [attr.name]="'q-' + line.id" type="text" inputmode="numeric" [value]="grouped(quantityOf(line.id))" (input)="setQuantity(line.id, $event)" /></label>
          }
          @if (problem(); as said) {
            <p class="refusal" role="alert">{{ said }}</p>
          }
          <div class="actions">
            <button type="submit" class="write">Prévoir cette réception</button>
            <button type="button" class="cancel" (click)="planning.set(false)">Fermer</button>
          </div>
        </form>
      } @else {
        <button type="button" class="plan-reception" (click)="openPlan()">{{ order().status === 'Draft' ? 'Déclarer des réceptions' : 'Prévoir une réception' }}</button>
      }
    </section>
  `,
  styles: `
    :host { display: block; margin-block: 12px; }
    h2 { margin: 0 0 6px; font: 700 1.1rem var(--font-hand); color: var(--color-earth); }
    .reception { padding: 8px 10px; margin-block-end: 6px; border: 2px solid var(--color-card-edge); border-inline-start-width: 6px; border-radius: 4px; background: var(--color-shell); }
    .reception.late { border-inline-start-color: var(--color-alert); }
    .reception.late .state { color: var(--color-alert); font-weight: 700; }
    .reception.today { border-inline-start-color: var(--color-orange); }
    .reception.coming { border-inline-start-color: var(--color-neutral); }
    .reception.received { border-inline-start-color: var(--color-pasture); }
    .when, .line-progress { margin: 0; color: var(--color-ink); }
    .line-progress { color: var(--color-muted); }
    .actions, .reschedule-form { display: flex; flex-wrap: wrap; gap: 6px; margin-block-start: 6px; }
    button { min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    .plan-reception, .write, .save-date { background: var(--color-pasture); color: var(--color-on-sign); }
    .reception-form { display: grid; gap: 8px; padding: 10px; border: 2px dashed var(--color-card-edge); border-radius: 4px; background: var(--color-shell); }
    .field { display: grid; gap: 4px; font-weight: 700; color: var(--color-ink); }
    input { min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); }
    .refusal { margin: 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    button:focus-visible, input:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class OrderReceptions {
  private readonly purchases = inject(Purchases);
  private readonly receptions = inject(Receptions);

  readonly order = input.required<OrderView>();
  /** Came from « Déclarer des réceptions » (Q.15): the form of the first reception opens at once. */
  readonly startOpen = input(false);
  protected readonly mine = computed(() => (this.receptions.view()?.receptions ?? []).filter(({ orderId }) => orderId === this.order().id));
  protected readonly grouped = grouped;

  protected readonly planning = signal(false);
  protected readonly plannedOn = signal('');
  private readonly quantities = signal<ReadonlyMap<string, string>>(new Map());
  protected readonly problem = signal<string | null>(null);
  protected readonly rescheduling = signal<string | null>(null);
  protected readonly newDate = signal('');

  constructor() {
    void this.receptions.load();
    afterNextRender(() => {
      if (this.startOpen()) this.openPlan();
    });
  }

  protected state(reception: ReceptionView) {
    return RECEPTION_STATE[reception.state];
  }

  protected day(day: string): string {
    return dayWords(day);
  }

  protected typeName(costTypeId: string): string {
    return this.purchases.costTypeById().get(costTypeId)?.name ?? '';
  }

  protected valueOf(event: Event): string {
    return typedText(event);
  }

  /** What is not planned yet of each line: ordered, less what its planned receptions expect. */
  protected openPlan(): void {
    const planned = new Map<string, number>();
    for (const reception of this.mine()) for (const line of reception.lines) planned.set(line.orderLineId, (planned.get(line.orderLineId) ?? 0) + line.expected);
    this.quantities.set(new Map(this.order().lines.map((line) => [line.id, String(Math.max(0, line.quantity - (planned.get(line.id) ?? 0)))])));
    this.plannedOn.set('');
    this.problem.set(null);
    this.planning.set(true);
  }

  protected quantityOf(orderLineId: string): string {
    return this.quantities().get(orderLineId) ?? '';
  }

  protected setQuantity(orderLineId: string, event: Event): void {
    const typed = typedNumber(event);
    this.quantities.update((all) => new Map(all).set(orderLineId, typed));
  }

  protected async plan(event: Event): Promise<void> {
    event.preventDefault();
    const lines = [...this.quantities()].map(([orderLineId, quantity]) => ({ orderLineId, quantity: Number(quantity) })).filter(({ quantity }) => quantity > 0);
    const done = await this.receptions.plan(this.order().id, crypto.randomUUID(), this.plannedOn(), lines);
    if (!done) return this.problem.set('La réception n’a pas été prévue : un jour, pas avant la commande, et au moins une quantité entière.');
    this.planning.set(false);
  }

  protected openReschedule(reception: ReceptionView): void {
    this.newDate.set(reception.plannedOn);
    this.rescheduling.set(reception.receptionId);
  }

  /** The same reception, the same lines, a new day: rescheduled, the old day kept (Q.14). */
  protected async reschedule(reception: ReceptionView): Promise<void> {
    const done = await this.receptions.plan(reception.orderId, reception.receptionId, this.newDate(), reception.lines.map(({ orderLineId, expected }) => ({ orderLineId, quantity: expected })));
    if (done) this.rescheduling.set(null);
  }

  protected async withdraw(reception: ReceptionView): Promise<void> {
    await this.receptions.withdraw(reception.orderId, reception.receptionId);
  }
}
