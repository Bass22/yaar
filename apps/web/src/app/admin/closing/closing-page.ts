import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NOTE_MAX_LENGTH } from '@domain/finance';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { Closing } from './closing';

type Entry = { readonly whole: string; readonly opened: boolean };

// Closing a lot (X.2; CdC « Les restes et le bilan »): its leftovers — everything ordered but the
// chicks, whole ones and one opened counted for half —, the lot of the same site that receives
// them, a comment; then a confirmation, since a closing is final. Online only.
@Component({
  selector: 'app-closing-page',
  imports: [Pictogram, RouterLink],
  providers: [Closing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="stamp-done" [decorative]="true" /> Clôturer une bande</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    @if (lots().length > 1) {
      <div class="lots" role="radiogroup" aria-label="Quelle bande clôturer ?">
        @for (lot of lots(); track lot.campaignId) {
          <label class="lot">
            <input type="radio" name="lot" [checked]="lot.campaignId === lotId()" (change)="choose(lot.campaignId)" />
            {{ lot.siteName }} · Jour {{ lot.campaignDay }}
          </label>
        }
      </div>
    }

    @if (lot(); as current) {
      <p class="current">La bande du {{ current.siteName }} · Jour {{ current.campaignDay }}</p>
      <section class="sheet" aria-label="Les restes">
        <h2><app-pictogram picto="open-bag" [decorative]="true" /> Les restes</h2>
        <p class="hint">Ce qui reste de ce qui a été commandé. Un sac, un pot ou un flacon commencé se coche « entamé » : il compte pour moitié.</p>
        @for (type of closing.leftoverTypes(); track type.id) {
          <div class="leftover" [attr.data-type]="type.id">
            <span class="name">{{ type.name }}</span>
            <label class="count">
              <input class="whole" type="text" inputmode="numeric" [value]="entry(type.id).whole" (input)="setWhole(type.id, $event)" [attr.aria-label]="'Combien de pleins : ' + type.name" placeholder="0" />
              <span class="unit">{{ type.category === 'Feed' || type.category === 'Bedding' ? 'sacs' : 'unités' }}</span>
            </label>
            <label class="half">
              <input class="opened" type="checkbox" [checked]="entry(type.id).opened" (change)="toggleOpened(type.id)" />
              + un entamé
            </label>
          </div>
        }
        @if (invalid()) {
          <p class="invalid" role="alert">Un nombre entier de sacs ou d’unités ; un entamé se coche à part.</p>
        }
        @if (leftovers().length === 0) {
          <p class="nothing-left">Aucun reste : rien ne passe à une autre bande.</p>
        } @else if (receivers().length === 0) {
          <p class="no-receiver" role="alert">Aucune autre bande en cours sur ce site : ouvre la suivante d’abord, ou ne saisis aucun reste.</p>
        } @else {
          <div class="receivers" role="radiogroup" aria-label="Quelle bande reçoit les restes ?">
            <p class="hint">Les restes passent à :</p>
            @for (other of receivers(); track other.campaignId) {
              <label class="lot">
                <input type="radio" name="receiver" [checked]="other.campaignId === receiver()" (change)="receiver.set(other.campaignId)" />
                {{ other.siteName }} · Jour {{ other.campaignDay }}
              </label>
            }
          </div>
          @if (receiver() === null) {
            <p class="no-receiver-chosen">Choisis la bande qui reçoit les restes.</p>
          }
        }
      </section>

      <section class="sheet" aria-label="Le commentaire du bilan">
        <h2><app-pictogram picto="pencil" [decorative]="true" /> Le commentaire du bilan</h2>
        <textarea class="comment" rows="4" [maxLength]="maxComment" [value]="comment()" (input)="setComment($event)" aria-label="Commentaire du bilan"></textarea>
      </section>

      @if (confirming()) {
        <div class="confirm" role="alertdialog" aria-label="Confirmer la clôture">
          <p>La clôture est définitive : plus aucune déclaration, aucun coût, aucune vente sur cette bande.</p>
          <button type="button" class="yes" [disabled]="sending()" (click)="send(current.campaignId)">Oui, clôturer</button>
          <button type="button" class="no" (click)="confirming.set(false)">Revenir</button>
        </div>
      } @else {
        <button type="button" class="close" [disabled]="!ready()" (click)="confirming.set(true)">
          <app-pictogram picto="stamp-done" [decorative]="true" /> Clôturer la bande
        </button>
      }
      @if (refusal(); as said) {
        <p class="refusal" role="alert">{{ said }}</p>
      }
    } @else {
      <p class="nothing-left">Aucune bande en cours.</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    h2 { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    h2 app-pictogram { inline-size: 28px; block-size: 28px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; display: inline-flex; align-items: center; min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .current { margin: 0; font: 700 1.1rem var(--font-hand); color: var(--color-ink); }
    .sheet { padding: 4px 12px 12px; margin-block-start: 14px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .hint { margin: 0 0 8px; color: var(--color-muted); font-size: 0.9rem; }
    .leftover { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: center; padding: 8px 0; border-block-end: 1px dashed var(--color-card-edge); }
    .name { grid-column: 1 / -1; font-weight: 700; color: var(--color-ink); }
    .count { display: inline-flex; align-items: center; gap: 6px; }
    .whole { inline-size: 4.5em; min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.1rem var(--font-hand); text-align: end; font-variant-numeric: tabular-nums; }
    .unit { color: var(--color-muted); }
    .half { display: inline-flex; align-items: center; gap: 6px; min-block-size: 44px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .half input { inline-size: 22px; block-size: 22px; accent-color: var(--color-pasture); }
    .receivers { display: flex; flex-wrap: wrap; gap: 8px; margin-block-start: 10px; }
    .receivers .hint { flex-basis: 100%; margin: 0; }
    .nothing-left, .no-receiver-chosen { margin: 10px 0 0; color: var(--color-muted); font-weight: 700; }
    .invalid, .no-receiver, .refusal { margin: 10px 0 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    .comment { box-sizing: border-box; inline-size: 100%; padding: 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 1rem var(--font-reading); line-height: 1.6; resize: vertical; }
    .close, .yes, .no { display: flex; align-items: center; justify-content: center; gap: 8px; inline-size: 100%; min-block-size: 56px; margin-block-start: 16px; border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); font: 700 1.1rem var(--font-hand); cursor: pointer; }
    .close { background: var(--color-earth); color: var(--color-on-sign); }
    .close app-pictogram { inline-size: 28px; block-size: 28px; }
    .close:disabled, .yes:disabled { opacity: 0.5; cursor: not-allowed; }
    .confirm { margin-block-start: 16px; padding: 12px; border: 3px solid var(--color-alert); border-radius: var(--radius-wobble-2); background: var(--color-shell); }
    .confirm p { margin: 0; font-weight: 700; color: var(--color-ink); }
    .yes { background: var(--color-alert); color: var(--color-on-sign); }
    .no { background: var(--color-paper); color: var(--color-ink); box-shadow: none; margin-block-start: 10px; }
    a:focus-visible, button:focus-visible, .lot:has(input:focus-visible), .half:has(input:focus-visible), .whole:focus-visible, .comment:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ClosingPage {
  protected readonly closing = inject(Closing);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly maxComment = NOTE_MAX_LENGTH;
  protected readonly lots = this.office.lots;
  protected readonly lotId = linkedSignal(() => this.route.snapshot.queryParamMap.get('lot') ?? this.office.lots()[0]?.campaignId ?? '');
  protected readonly lot = computed(() => this.lots().find((lot) => lot.campaignId === this.lotId()) ?? null);
  private readonly entries = signal<ReadonlyMap<string, Entry>>(new Map());
  protected readonly receiver = signal<string | null>(null);
  protected readonly comment = signal('');
  protected readonly confirming = signal(false);
  protected readonly sending = signal(false);
  protected readonly refusal = signal<string | null>(null);

  /** The other running lots of the same site: the only ones that can receive the leftovers. */
  protected readonly receivers = computed(() => {
    const current = this.lot();
    return current === null ? [] : this.lots().filter((lot) => lot.siteId === current.siteId && lot.campaignId !== current.campaignId);
  });
  protected readonly invalid = computed(() => [...this.entries().values()].some(({ whole }) => whole.trim() !== '' && !/^\d+$/.test(whole.trim())));
  protected readonly leftovers = computed(() =>
    this.closing
      .leftoverTypes()
      .map((type) => ({ costTypeId: type.id, whole: Number(this.entry(type.id).whole.trim() || '0'), opened: this.entry(type.id).opened }))
      .filter(({ whole, opened }) => whole > 0 || opened),
  );
  protected readonly ready = computed(() => !this.invalid() && (this.leftovers().length === 0 || this.receivers().some((lot) => lot.campaignId === this.receiver())));

  constructor() {
    void this.closing.loadCostTypes();
  }

  protected entry(typeId: string): Entry {
    return this.entries().get(typeId) ?? { whole: '', opened: false };
  }

  protected choose(campaignId: string): void {
    this.lotId.set(campaignId);
    this.receiver.set(null);
  }

  protected setWhole(typeId: string, event: Event): void {
    const whole = (event.target as HTMLInputElement).value;
    this.entries.update((entries) => new Map(entries).set(typeId, { ...this.entry(typeId), whole }));
  }

  protected toggleOpened(typeId: string): void {
    this.entries.update((entries) => new Map(entries).set(typeId, { ...this.entry(typeId), opened: !this.entry(typeId).opened }));
  }

  protected setComment(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
  }

  protected async send(campaignId: string): Promise<void> {
    this.sending.set(true);
    const leftovers = this.leftovers();
    const comment = this.comment().trim();
    const refusal = await this.closing.close(campaignId, { leftovers, leftoversTo: leftovers.length === 0 ? null : this.receiver(), comment: comment === '' ? null : this.comment() });
    this.sending.set(false);
    this.confirming.set(false);
    this.refusal.set(refusal);
    if (refusal === null) {
      void this.office.refresh();
      await this.router.navigate(['/admin/lots/bilan', campaignId]);
    }
  }
}
