import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { PictogramName } from '@design-system';
import type { CounterpartyFaceCode, DraftOrderRequest } from '@contracts';
import { COUNTERPARTY_FACES, draftOrder, orderedAmount } from '@domain/finance';
import type { CurrencyCode } from '@kit';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { amountWords, Purchases, type PurchaseProblem } from './purchases';

type LineDraft = { readonly id: string; readonly costTypeId: string; readonly quantity: string; readonly unitPrice: string };

/** What each face says of a supplier: the real object, and its word. */
const FACE_WORDS: Record<CounterpartyFaceCode, string> = {
  'closed-bag': 'Aliment',
  chick: 'Poussins',
  syringe: 'Véto',
  truck: 'Transport',
  caretaker: 'Une personne',
  hen: 'Poulets',
  drinker: 'Eau',
  barn: 'Bâtiment',
  paper: 'Autre',
};

const WORDS: Partial<Record<PurchaseProblem, string>> = {
  NoLot: 'Choisis le lot.',
  NoSupplier: 'Choisis le fournisseur.',
  InvalidId: 'Choisis ce que tu commandes, sur chaque ligne.',
  OrderWithoutLines: 'Ajoute au moins une ligne.',
  InvalidQuantity: 'Sur chaque ligne, une quantité d’au moins 1.',
  InvalidUnitPrice: 'Sur chaque ligne, un prix en francs entiers.',
  InvalidBusinessDay: 'La date n’est pas une date.',
  UnknownCostType: 'Ce type ne se commande pas.',
  CostTypeNotOrderable: 'Ce type ne se commande pas.',
  CostTypeArchived: 'Ce type ne se commande plus.',
  UnknownCounterparty: 'Ce fournisseur n’est plus disponible.',
  NotASupplier: 'Ce fournisseur n’est plus disponible.',
  CounterpartyArchived: 'Ce fournisseur n’est plus disponible.',
  UnknownCampaign: 'Ce lot n’existe plus.',
  CampaignClosed: 'Ce lot est clos : on ne commande plus pour lui.',
  OrderAnnounced: 'Cette commande est annoncée : elle ne change plus.',
  OrderAlreadyAnnounced: 'Cette commande est annoncée : elle ne change plus.',
  InvalidName: 'Le nom du fournisseur va de 1 à 60 caractères.',
  NoNetwork: 'Pas de réseau : rien n’est enregistré. Réessaie avec le réseau.',
};
const SERVER_ERROR = 'Le serveur n’a pas pu enregistrer. Réessaie.';

/** The real object of each orderable category. Copeaux has none drawn yet: its word stands alone (to draw, then check in the field). */
const CATEGORY_PICTO: Partial<Record<string, PictogramName>> = { Feed: 'closed-bag', Chicks: 'chick', Health: 'syringe' };

const emptyLine = (): LineDraft => ({ id: crypto.randomUUID(), costTypeId: '', quantity: '', unitPrice: '' });

/**
 * Writing an order (Q.5), online: for which lot, from whom, then line by line — what, how many, at
 * what price. The total is the domain's, recomputed while typing; the order is judged by the
 * domain before it leaves, and by the server, which decides. A supplier is created on the spot.
 */
@Component({
  selector: 'app-order-editor-page',
  imports: [Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="truck" [decorative]="true" /> {{ editing() ? 'Modifier la commande' : 'Nouvelle commande' }}</h1>
    <a class="back" routerLink="..">Annuler, revenir aux achats</a>
    @if (locked()) {
      <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> Cette commande est annoncée : elle ne change plus.</p>
    } @else {
      <!-- novalidate: the domain judges, and says why in words. -->
      <form novalidate (submit)="$event.preventDefault(); save()">
        <fieldset>
          <legend><app-pictogram picto="barn" [decorative]="true" /> Pour quel lot ?</legend>
          <div class="tiles">
            @for (lot of office.lots(); track lot.campaignId) {
              <label class="tile">
                <input type="radio" name="lot" [value]="lot.campaignId" [checked]="lot.campaignId === lotId()" (change)="lotId.set(lot.campaignId)" />
                <app-pictogram picto="chick" [decorative]="true" />
                <span class="name">{{ lot.siteName }}</span>
                <small>Jour {{ lot.campaignDay }}</small>
              </label>
            }
          </div>
        </fieldset>

        <fieldset>
          <legend><app-pictogram picto="truck" [decorative]="true" /> Chez qui ?</legend>
          <div class="tiles">
            @for (supplier of purchases.suppliers(); track supplier.id) {
              <label class="tile supplier">
                <input type="radio" name="supplier" [value]="supplier.id" [checked]="supplier.id === supplierId()" (change)="supplierId.set(supplier.id)" />
                <app-pictogram [picto]="face(supplier.face)" [decorative]="true" />
                <span class="name">{{ supplier.name }}</span>
              </label>
            }
            <label class="tile supplier new">
              <input type="checkbox" [checked]="creating()" (change)="creating.set(!creating())" />
              <span class="plus" aria-hidden="true"></span>
              <span class="name">Nouveau fournisseur</span>
            </label>
          </div>
          @if (creating()) {
            <div class="new-supplier">
              <label class="field">
                <span>Son nom</span>
                <input name="supplierName" type="text" maxlength="60" [value]="newName()" (input)="newName.set(valueOf($event))" />
              </label>
              <span class="ask">Ce qu’il fournit</span>
              <div class="faces">
                @for (one of faces; track one) {
                  <label class="face-choice">
                    <input type="radio" name="face" [value]="one" [checked]="one === newFace()" (change)="newFace.set(one)" />
                    <app-pictogram [picto]="face(one)" [decorative]="true" />
                    <small>{{ faceWords[one] }}</small>
                  </label>
                }
              </div>
              <button type="button" class="create-supplier" [disabled]="busy()" (click)="createSupplier()"><app-pictogram picto="check" [decorative]="true" /> Ajouter ce fournisseur</button>
            </div>
          }
        </fieldset>

        <div class="when">
          <label class="field">
            <span>Commandé le</span>
            <input class="day" name="orderDay" type="date" [value]="orderDay()" (input)="orderDay.set(valueOf($event))" />
          </label>
          <label class="field">
            <span>N° du bon</span>
            <input name="reference" type="text" maxlength="40" placeholder="facultatif" [value]="reference()" (input)="reference.set(valueOf($event))" />
          </label>
        </div>

        <fieldset>
          <legend><app-pictogram picto="paper" [decorative]="true" /> Ce que tu commandes</legend>
          <ol class="lines">
            @for (line of lines(); track line.id; let index = $index) {
              <li class="line">
                <div class="types" role="radiogroup" [attr.aria-label]="'Ligne ' + (index + 1)">
                  @for (type of purchases.orderableTypes(); track type.id) {
                    <label class="type-choice">
                      <input type="radio" [name]="'type-' + line.id" [value]="type.id" [checked]="type.id === line.costTypeId" (change)="edit(index, { costTypeId: type.id })" />
                      @if (categoryPicto[type.category]; as picto) {
                        <app-pictogram [picto]="picto" [decorative]="true" />
                      }
                      {{ type.name }}
                    </label>
                  }
                </div>
                <div class="figures">
                  <label class="field">
                    <span>Combien ?</span>
                    <input name="quantity" type="number" inputmode="numeric" min="1" step="1" [value]="line.quantity" (input)="edit(index, { quantity: valueOf($event) })" />
                  </label>
                  <span class="times" aria-hidden="true">×</span>
                  <label class="field">
                    <span>Prix l’unité</span>
                    <input name="unitPrice" type="number" inputmode="numeric" min="0" step="1" [value]="line.unitPrice" (input)="edit(index, { unitPrice: valueOf($event) })" />
                  </label>
                </div>
                @if (lines().length > 1) {
                  <button type="button" class="remove-line" (click)="remove(index)"><app-pictogram picto="cross" [decorative]="true" /> Retirer la ligne</button>
                }
              </li>
            }
          </ol>
          <button type="button" class="add-line" (click)="add()">Ajouter une ligne</button>
        </fieldset>

        @if (problem(); as problem) {
          <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ problem }}</p>
        }
        <div class="actions">
          <p class="total"><span>Total</span> <strong>{{ total() }}</strong></p>
          <button type="submit" class="go" [disabled]="busy()"><app-pictogram picto="check" [decorative]="true" /> Enregistrer</button>
        </div>
      </form>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 8px; color: var(--color-ink); font-weight: 700; }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    form { display: grid; gap: 20px; padding-block-end: 88px; }
    fieldset { margin: 0; padding: 0; border: 0; min-inline-size: 0; }
    legend, .ask { display: flex; align-items: center; gap: 8px; margin-block-end: 8px; padding: 0; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    legend app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }

    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .tile {
      position: relative; display: grid; grid-template-columns: 40px 1fr; grid-template-rows: auto auto; align-content: center; column-gap: 10px;
      min-block-size: 64px; padding: 8px 12px; cursor: pointer;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1);
      box-shadow: var(--shadow-hard-sm); color: var(--color-earth);
    }
    .tile:nth-child(even) { border-radius: var(--radius-wobble-2); }
    .tile input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .tile app-pictogram, .tile .plus { grid-row: 1 / 3; align-self: center; inline-size: 40px; block-size: 40px; }
    .tile .plus { display: grid; place-items: center; font: 700 1.8rem var(--font-hand); }
    .tile .plus::before { content: '+'; }
    .tile .name { align-self: end; font: 700 1rem var(--font-hand); }
    .tile .name:last-child { grid-row: 1 / 3; align-self: center; }
    .tile small { color: var(--color-muted); }
    .tile.new { border-style: dashed; }
    .tile:has(input:checked) { border-color: var(--color-pasture); border-style: solid; background: var(--color-pasture-light); box-shadow: var(--shadow-hard); }
    .tile:has(input[type='radio']:checked)::after {
      content: '✓'; position: absolute; inset-block-start: -10px; inset-inline-end: -8px; display: grid; place-items: center;
      inline-size: 26px; block-size: 26px; border-radius: var(--radius-blob); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700;
    }
    .tile:has(input:focus-visible), .face-choice:has(input:focus-visible), .type-choice:has(input:focus-visible) { outline: 4px solid var(--color-blue); outline-offset: 2px; }

    .new-supplier { display: grid; gap: 10px; margin-block-start: 12px; padding: 12px; background: var(--color-post-it); border-radius: var(--radius-wobble-3); box-shadow: var(--shadow-hard-sm); }
    .faces { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 8px; }
    .face-choice { position: relative; display: grid; justify-items: center; gap: 2px; padding: 6px 4px; border: 2px solid transparent; border-radius: var(--radius-blob); cursor: pointer; }
    .face-choice input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .face-choice app-pictogram { inline-size: 36px; block-size: 36px; }
    .face-choice small { font-size: 0.8rem; color: var(--color-earth); }
    .face-choice:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }

    .field { display: grid; gap: 4px; font-weight: 700; color: var(--color-earth); }
    .field small { font-weight: 400; color: var(--color-muted); }
    .field input {
      min-block-size: 48px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 4px;
      background: var(--color-paper); color: var(--color-ink); font: 1.1rem var(--font-reading); min-inline-size: 0;
    }
    .when { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }

    .lines { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 12px; }
    .line { display: grid; gap: 10px; padding: 12px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .types { display: flex; flex-wrap: wrap; gap: 8px; }
    .type-choice {
      position: relative; display: inline-flex; align-items: center; gap: 6px; min-block-size: 44px; padding: 0 14px; cursor: pointer;
      border: 2px solid var(--color-card-edge); border-radius: 999px; background: var(--color-paper); font-weight: 700; color: var(--color-earth);
    }
    .type-choice app-pictogram { inline-size: 24px; block-size: 24px; }
    .type-choice input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .type-choice:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture); color: var(--color-on-sign); }
    .figures { display: grid; grid-template-columns: 1fr auto 1fr; align-items: end; gap: 8px; }
    .figures input { font: 700 1.3rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums; }
    .times { padding-block-end: 12px; font: 700 1.3rem var(--font-hand); color: var(--color-muted); }
    .remove-line, .add-line {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-block-size: 48px; padding: 0 14px;
      border: 2px dashed var(--color-card-edge); border-radius: 4px; background: transparent; color: var(--color-ink); font-weight: 700;
    }
    .remove-line app-pictogram { inline-size: 20px; block-size: 20px; }
    .add-line { inline-size: 100%; font: 700 1rem var(--font-hand); }
    .create-supplier {
      display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-block-size: 52px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.05rem var(--font-hand);
    }
    .create-supplier app-pictogram { inline-size: 22px; block-size: 22px; }

    input:focus-visible, button:focus-visible, a:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }

    /* Always in sight, above the bar of five: the total, and the one action of the page. */
    .actions {
      position: fixed; inset-inline: 0; inset-block-end: var(--office-tabs-block-size, 0); z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 8px 16px; background: var(--color-paper); border-block-start: 2px dashed var(--color-card-edge);
    }
    .total { display: grid; margin: 0; color: var(--color-earth); font-weight: 700; line-height: 1.1; }
    .total strong { font: 700 1.45rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .go {
      display: inline-flex; align-items: center; gap: 8px; min-block-size: 52px; padding: 0 22px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .go app-pictogram { inline-size: 24px; block-size: 24px; }
    .go:disabled, .create-supplier:disabled { opacity: 0.6; }
  `,
})
export class OrderEditorPage {
  protected readonly purchases = inject(Purchases);
  protected readonly office = inject(Office);
  private readonly router = inject(Router);
  // The office lives under a prefix (/admin): every link is relative to this page's route.
  private readonly route = inject(ActivatedRoute);

  protected readonly faces = COUNTERPARTY_FACES;
  protected readonly faceWords = FACE_WORDS;
  protected readonly categoryPicto = CATEGORY_PICTO;
  private readonly orderId = this.route.snapshot.paramMap.get('id');
  protected readonly editing = computed(() => this.orderId !== null);
  private readonly order = computed(() => (this.orderId === null ? null : (this.purchases.orders().find((order) => order.id === this.orderId) ?? null)));
  protected readonly locked = computed(() => this.order() !== null && this.order()?.status !== 'Draft');

  /** The only running lot is chosen for the admin; with several, nothing is chosen ahead. */
  protected readonly lotId = linkedSignal(() => this.order()?.campaignId ?? (this.office.lots().length === 1 ? (this.office.lots()[0]?.campaignId ?? '') : ''));
  protected readonly supplierId = linkedSignal(() => this.order()?.supplierId ?? '');
  private readonly today = computed(() => this.office.sites()[0]?.today ?? '');
  protected readonly orderDay = linkedSignal(() => this.order()?.orderDay ?? this.today());
  protected readonly reference = linkedSignal(() => this.order()?.reference ?? '');
  protected readonly lines = linkedSignal<readonly LineDraft[]>(() => {
    const order = this.order();
    return order === null ? [emptyLine()] : order.lines.map((line) => ({ id: line.id, costTypeId: line.costTypeId, quantity: String(line.quantity), unitPrice: String(line.unitPrice) }));
  });

  protected readonly creating = signal(false);
  protected readonly newName = signal('');
  protected readonly newFace = signal<CounterpartyFaceCode>('closed-bag');
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);

  /** The domain's total of the lines typed so far: the ones with a quantity and a price. */
  protected readonly total = computed(() => {
    const currency = this.purchases.currency();
    if (currency === null) return '—';
    const typed = this.lines()
      .filter((line) => line.quantity.trim() !== '' && line.unitPrice.trim() !== '')
      .map((line) => ({ quantity: Number(line.quantity), unitPrice: Number(line.unitPrice) }));
    const total = orderedAmount(typed, currency as CurrencyCode);
    return total.ok ? amountWords(total.value.amount, currency) : '—';
  });

  constructor() {
    void this.purchases.load();
  }

  protected face(code: string): PictogramName {
    return code as PictogramName;
  }

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected edit(index: number, change: Partial<LineDraft>): void {
    this.lines.update((lines) => lines.map((line, at) => (at === index ? { ...line, ...change } : line)));
  }

  protected add(): void {
    this.lines.update((lines) => [...lines, emptyLine()]);
  }

  protected remove(index: number): void {
    this.lines.update((lines) => lines.filter((_, at) => at !== index));
  }

  protected async createSupplier(): Promise<void> {
    if (this.busy()) return;
    if (this.newName().trim() === '') {
      this.problem.set(WORDS.InvalidName ?? SERVER_ERROR);
      return;
    }
    this.busy.set(true);
    const created = await this.purchases.createSupplier(this.newName(), this.newFace());
    this.busy.set(false);
    if ('problem' in created) {
      this.problem.set(WORDS[created.problem] ?? SERVER_ERROR);
      return;
    }
    this.problem.set(null);
    this.supplierId.set(created.supplier.id);
    this.creating.set(false);
    this.newName.set('');
  }

  protected async save(): Promise<void> {
    const currency = this.purchases.currency();
    if (this.busy() || currency === null) return;
    if (this.lotId() === '') return this.problem.set(WORDS.NoLot ?? SERVER_ERROR);
    if (this.supplierId() === '') return this.problem.set(WORDS.NoSupplier ?? SERVER_ERROR);
    const request: DraftOrderRequest = {
      id: this.orderId ?? crypto.randomUUID(),
      supplierId: this.supplierId(),
      campaignId: this.lotId(),
      orderDay: this.orderDay(),
      reference: this.reference().trim() === '' ? null : this.reference().trim(),
      lines: this.lines().map((line) => ({ id: line.id, costTypeId: line.costTypeId, quantity: numberOf(line.quantity), unitPrice: numberOf(line.unitPrice) })),
    };
    // The same rule as the server's, so that a refusal is said before anything leaves.
    const judged = draftOrder(request, {
      currency: currency as CurrencyCode,
      counterparties: [...this.purchases.counterpartyById().values()].map(({ id, kind, archived }) => ({ id, kind, archived })),
      costTypes: [...this.purchases.costTypeById().values()].map(({ id, orderable, archived }) => ({ id, orderable, archived })),
    });
    if (!judged.ok) return this.problem.set(WORDS[judged.error.kind] ?? SERVER_ERROR);
    this.busy.set(true);
    this.problem.set(null);
    const problem = await this.purchases.saveDraft(request, this.orderId === null);
    this.busy.set(false);
    if (problem !== null) return this.problem.set(WORDS[problem] ?? SERVER_ERROR);
    await this.router.navigate(['..'], { relativeTo: this.route });
  }
}

// An empty field is no figure at all: the domain then says which one is missing.
const numberOf = (typed: string): number => (typed.trim() === '' ? Number.NaN : Number(typed));
