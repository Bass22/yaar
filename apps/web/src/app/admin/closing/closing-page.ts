import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NOTE_MAX_LENGTH } from '@domain/finance';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { Closing } from './closing';
import { CurrentLot, currentLotOf } from '../lots/current-lot';
import { byTheBag } from '@domain/journal';

// `openedKg`: the kg left in an opened bag of feed, typed when known (N.8d).
type Entry = { readonly whole: string; readonly opened: boolean; readonly openedKg?: string };

// Closing a lot (X.2; CdC « Les restes et le bilan »): its leftovers — everything ordered but the
// chicks, whole ones and one opened counted for half —, the lot of the same site that receives
// them, a comment; then a confirmation, since a closing is final. Online only.
@Component({
  selector: 'app-closing-page',
  imports: [CurrentLot, Pictogram, RouterLink],
  providers: [Closing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="stamp-done" [decorative]="true" /> Clôturer une bande</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    <app-current-lot />

    @if (lot(); as current) {
      <section class="sheet" aria-label="Les restes">
        <h2><app-pictogram picto="open-bag" [decorative]="true" /> Les restes</h2>
        <p class="hint">Ce qui reste de ce qui a été commandé. Un sac, un pot ou un flacon commencé se coche « entamé » : il compte pour moitié.</p>
        @for (type of closing.leftoverTypes(); track type.id) {
          <div class="leftover" [attr.data-type]="type.id">
            <span class="name">{{ type.name }}</span>
            <label class="count">
              <input class="whole" type="text" inputmode="numeric" [value]="entry(type.id).whole" (input)="setWhole(type.id, $event)" [attr.aria-label]="'Combien de pleins : ' + type.name" placeholder="0" />
              <span class="unit">{{ unitWord(type.category) }}</span>
            </label>
            <label class="half">
              <input class="opened" type="checkbox" [checked]="entry(type.id).opened" (change)="toggleOpened(type.id)" />
              + un entamé
            </label>
            @if (type.category === 'Feed' && entry(type.id).opened) {
              <label class="kg">
                <input class="opened-kg" type="text" inputmode="numeric" autocomplete="off" [value]="entry(type.id).openedKg ?? ''" (input)="setOpenedKg(type.id, $event)" [attr.aria-label]="'Kg restants dans l’entamé : ' + type.name" placeholder="?" />
                kg restants, si tu sais
              </label>
            }
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
                {{ other.siteName }} · {{ other.dayLabel }}
              </label>
            }
          </div>
          @if (receiver() === null) {
            <p class="no-receiver-chosen">Choisis la bande qui reçoit les restes.</p>
          }
        }
      </section>

      @if (feedGap(); as gap) {
        <section class="sheet feed-gap" aria-label="Les sacs d’aliment">
          <h2><app-pictogram picto="open-bag" [decorative]="true" /> Les sacs d’aliment</h2>
          <p role="alert">{{ gapWords(gap) }}</p>
          <a class="journal" routerLink="/admin/lots/journal" [queryParams]="{ lot: current.campaignId }">Ouvrir le journal de la bande</a>
          <textarea class="feed-gap-comment" rows="3" [maxLength]="maxComment" [value]="feedGapComment()" (input)="feedGapComment.set(textOf($event))" aria-label="Expliquer l’écart des sacs d’aliment"></textarea>
        </section>
      }

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
    .kg { display: flex; align-items: center; gap: 6px; flex-basis: 100%; color: var(--color-muted); font-size: 0.9rem; }
    .opened-kg { inline-size: 4.5em; min-block-size: 44px; padding: 0 6px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); text-align: end; }
    .feed-gap p { margin: 0 0 8px; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    .feed-gap .journal { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .feed-gap-comment { box-sizing: border-box; inline-size: 100%; padding: 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 1rem var(--font-reading); line-height: 1.6; resize: vertical; }
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
    a:focus-visible, button:focus-visible, .lot:has(input:focus-visible), .half:has(input:focus-visible), .whole:focus-visible, .comment:focus-visible, .opened-kg:focus-visible, .feed-gap-comment:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ClosingPage {
  /** What a leftover is counted in: bags for feed and bedding, units otherwise. */
  protected unitWord(category: string): string {
    return byTheBag(category) ? 'sacs' : 'unités';
  }

  protected readonly closing = inject(Closing);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly maxComment = NOTE_MAX_LENGTH;
  protected readonly lots = this.office.lots;
  protected readonly lotId = currentLotOf(this.office, this.route);
  protected readonly lot = computed(() => this.lots().find((lot) => lot.campaignId === this.lotId()) ?? null);
  private readonly entries = signal<ReadonlyMap<string, Entry>>(new Map());
  // Reset when the lot changes: a receiver belongs to the site of the lot being closed.
  protected readonly receiver = linkedSignal<string | null>(() => (this.lotId(), null));
  protected readonly comment = signal('');
  protected readonly confirming = signal(false);
  protected readonly sending = signal(false);
  protected readonly refusal = signal<string | null>(null);
  /** The gap of the bags of feed the server found, to explain or to fix in the journal (N.8d). */
  protected readonly feedGap = signal<{ readonly expected: number; readonly counted: number; readonly gap: number } | null>(null);
  protected readonly feedGapComment = signal('');

  /** The other running lots of the same site: the only ones that can receive the leftovers. */
  protected readonly receivers = computed(() => {
    const current = this.lot();
    return current === null ? [] : this.lots().filter((lot) => lot.siteId === current.siteId && lot.campaignId !== current.campaignId);
  });
  protected readonly invalid = computed(() => [...this.entries().values()].some(({ whole }) => whole.trim() !== '' && !/^\d+$/.test(whole.trim())));
  protected readonly leftovers = computed(() =>
    this.closing
      .leftoverTypes()
      .map((type) => {
        const { whole, opened, openedKg = '' } = this.entry(type.id);
        const kg = openedKg.trim();
        // Typed in kg, sent in grams; untyped, half the bag (N.8d).
        const weight = type.category === 'Feed' && opened && /^\d+$/.test(kg) && Number(kg) > 0 ? { openedWeight: Number(kg) * 1000 } : {};
        return { costTypeId: type.id, whole: Number(whole.trim() || '0'), opened, ...weight };
      })
      .filter(({ whole, opened }) => whole > 0 || opened),
  );
  protected readonly ready = computed(() => !this.invalid() && (this.leftovers().length === 0 || this.receivers().some((lot) => lot.campaignId === this.receiver())));

  constructor() {
    void this.closing.loadCostTypes();
  }

  protected entry(typeId: string): Entry {
    return this.entries().get(typeId) ?? { whole: '', opened: false };
  }


  protected setWhole(typeId: string, event: Event): void {
    const whole = (event.target as HTMLInputElement).value;
    this.entries.update((entries) => new Map(entries).set(typeId, { ...this.entry(typeId), whole }));
  }

  protected toggleOpened(typeId: string): void {
    this.entries.update((entries) => new Map(entries).set(typeId, { ...this.entry(typeId), opened: !this.entry(typeId).opened }));
  }

  protected setOpenedKg(typeId: string, event: Event): void {
    const openedKg = (event.target as HTMLInputElement).value;
    this.entries.update((entries) => new Map(entries).set(typeId, { ...this.entry(typeId), openedKg }));
  }

  protected textOf(event: Event): string {
    return (event.target as HTMLTextAreaElement).value;
  }

  /** « 1 sac d’aliment de moins qu’attendu : 3 attendus, 2 comptés. … » */
  protected gapWords({ expected, counted, gap }: { readonly expected: number; readonly counted: number; readonly gap: number }): string {
    const bags = `${Math.abs(gap)} sac${Math.abs(gap) > 1 ? 's' : ''} d’aliment`;
    const figures = `${expected} attendu${expected > 1 ? 's' : ''}, ${counted} compté${counted > 1 ? 's' : ''}`;
    return gap < 0
      ? `${bags} de moins qu’attendu : ${figures}. Une ouverture n’a peut-être pas été déclarée : corrige le journal, ou explique l’écart.`
      : `${bags} de plus qu’attendu : ${figures}. Une ouverture déclarée en trop, ou une livraison jamais déclarée ? Corrige le journal, ou explique l’écart.`;
  }

  protected setComment(event: Event): void {
    this.comment.set((event.target as HTMLTextAreaElement).value);
  }

  protected async send(campaignId: string): Promise<void> {
    this.sending.set(true);
    const leftovers = this.leftovers();
    const comment = this.comment().trim();
    const gapComment = this.feedGapComment().trim();
    const refusal = await this.closing.close(campaignId, {
      leftovers,
      leftoversTo: leftovers.length === 0 ? null : this.receiver(),
      comment: comment === '' ? null : this.comment(),
      ...(gapComment === '' ? {} : { feedGapComment: gapComment }),
    });
    this.sending.set(false);
    this.confirming.set(false);
    this.refusal.set(refusal === null || refusal.feedGap !== undefined ? null : refusal.words);
    if (refusal?.feedGap !== undefined) this.feedGap.set(refusal.feedGap);
    if (refusal === null) {
      void this.office.refresh();
      await this.router.navigate(['/admin/lots/bilan', campaignId]);
    }
  }
}
