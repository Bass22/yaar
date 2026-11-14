import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { WeighingToValidate } from '@contracts';
import { averageWeight, outOfBounds, strainOf, targetAt, Weight } from '@domain/journal';
import { Pictogram } from '../../ui/pictogram';
import { WeightChart } from '../tracking/weight-chart/weight-chart';
import { FiguresAge } from '../figures-age';
import { Office } from '../office';
import { Weighings } from './weighings';
import { CurrentLot, currentLotOf } from '../lots/current-lot';
import { dayWords } from '../typed-number';

/** Grams with a space every three digits: 1843 → « 1 843 ». */
const grams = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const nextDay = (on: string): string => new Date(Date.parse(`${on}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

type Draft = { readonly typed: readonly string[]; readonly problem: string | null; readonly sending: boolean };

// The weighings of a lot (T.2, T.5; CdC « Les pesées », decisions of 2026-11-12): ask the caretaker
// for one, today or tomorrow; each weighing declared, with its five weights the admin corrects at
// the keyboard — the average follows, computed by domain/journal — then « Valider »; and the real
// curve, validated weighings only, against the strain's target. Stands in for the inbox (O.4).
@Component({
  selector: 'app-weighings-page',
  imports: [CurrentLot, FiguresAge, Pictogram, RouterLink, WeightChart],
  providers: [Weighings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="scale" [decorative]="true" /> Pesées</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    <app-current-lot />
    <app-figures-age [readAt]="weighings.readAt()" [stale]="weighings.unreachable()" />

    <section class="ask-box" aria-label="Demander une pesée">
      <div class="when" role="radiogroup" aria-label="Pour quel jour ?">
        <label class="tile today"><input type="radio" name="when" [checked]="when() === 'today'" (change)="when.set('today')" /> Aujourd'hui</label>
        <label class="tile tomorrow"><input type="radio" name="when" [checked]="when() === 'tomorrow'" (change)="when.set('tomorrow')" /> Demain</label>
      </div>
      <button type="button" class="ask" [disabled]="asking() || weighings.view() === null" (click)="ask()"><app-pictogram picto="scale" [decorative]="true" /> Demander une pesée</button>
      @if (askWords(); as words) {
        <p class="said" [attr.role]="askFailed() ? 'alert' : 'status'">{{ words }}</p>
      }
      @for (request of weighings.view()?.openRequests ?? []; track request.weighingRequestId) {
        <p class="open-request"><app-pictogram picto="stamp-pending" [decorative]="true" /> Pesée demandée pour le {{ day(request.requestedFor) }}, pas encore faite</p>
      }
    </section>

    <h2>À valider</h2>
    @if (weighings.view()?.toValidate?.length === 0) {
      <p class="none"><app-pictogram picto="round-check" [decorative]="true" /> Aucune pesée à valider.</p>
    }
    @for (weighing of weighings.view()?.toValidate ?? []; track weighing.weighingId) {
      <article class="to-validate">
        <p class="who"><b>{{ weighing.authorName }}</b> · {{ day(weighing.businessDate) }} · Jour {{ weighing.campaignDay }}</p>
        <div class="weights">
          @for (typed of draftOf(weighing).typed; track $index) {
            <label class="weight" [class.out]="outOfBounds(weighing, typed)">
              @if (weighing.photos?.[$index]; as fingerprint) {
                @if (photoUrls().get(fingerprint); as url) {
                  <img class="balance" [src]="url" [alt]="'La balance du poulet ' + ($index + 1)" />
                } @else {
                  <span class="no-photo">photo en chargement</span>
                }
              } @else {
                <span class="no-photo">pas de photo</span>
              }
              <span class="rank">Poulet {{ $index + 1 }}</span>
              <input type="text" inputmode="numeric" autocomplete="off" [attr.data-rank]="$index + 1" [value]="typed" (input)="retype(weighing, $index, $event)" [attr.aria-label]="'Poids du poulet ' + ($index + 1) + ', en grammes'" />
              <small>g</small>
              @if (outOfBounds(weighing, typed)) {
                <span class="bounds">hors des bornes</span>
              }
            </label>
          }
        </div>
        <p class="average">
          @if (averageOf(weighing); as average) {
            Moyenne {{ grams(average) }} g
          } @else {
            Moyenne : un poids manque
          }
          @if (targetOn(weighing.campaignDay); as target) {
            · cible {{ grams(target) }} g
          }
        </p>
        @if (draftOf(weighing).problem; as problem) {
          <p class="problem" role="alert">{{ problem }}</p>
        }
        <button type="button" class="validate" [disabled]="averageOf(weighing) === null || draftOf(weighing).sending" (click)="validate(weighing)"><app-pictogram picto="check" [decorative]="true" /> Valider</button>
      </article>
    }

    <h2>La courbe réelle</h2>
    @if (weighings.view()?.curve?.length === 0) {
      <p class="none"><app-pictogram picto="scale" [decorative]="true" /> Aucune pesée validée pour ce lot.</p>
    }
    @if (weighings.view(); as view) {
      <app-weight-chart [curve]="view.curve" [strain]="strain()" />
    }
    <ol class="curve">
      @for (point of weighings.view()?.curve ?? []; track point.weighingId) {
        <li>
          <span class="day">Jour {{ point.campaignDay }}</span>&ngsp;<strong>{{ grams(point.average) }} g</strong>
          @if (targetOn(point.campaignDay); as target) {
            &ngsp;<small>cible {{ grams(target) }} g</small>
          }
        </li>
      }
    </ol>
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    h2 { margin: 18px 0 8px; font: 700 1.15rem var(--font-hand); color: var(--color-earth); }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-end: 10px; }
    .lot { position: relative; padding: 8px 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input, .tile input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .ask-box { padding: 12px; background: var(--color-slot-active); border: 2px solid var(--color-blue); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .when { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-block-end: 10px; }
    .tile {
      position: relative; display: grid; place-items: center; min-block-size: 48px; cursor: pointer; background: var(--color-shell);
      border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); font: 700 1.05rem var(--font-hand); color: var(--color-earth);
    }
    .tile:has(input:checked) { border: 3px solid var(--color-blue); color: var(--color-blue); }
    .ask, .validate {
      inline-size: 100%; min-block-size: 52px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); color: var(--color-on-sign); font: 700 1.1rem var(--font-hand);
    }
    .ask { background: var(--color-blue); }
    .validate { background: var(--color-pasture); margin-block-start: 8px; }
    .ask app-pictogram, .validate app-pictogram { inline-size: 26px; block-size: 26px; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .said, .open-request { display: flex; align-items: center; gap: 8px; margin: 8px 0 0; font-weight: 700; color: var(--color-earth); }
    .open-request app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }
    .to-validate {
      margin-block-end: 12px; padding: 12px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-inline-start: 6px solid var(--color-orange);
      border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm);
    }
    .who { margin: 0 0 8px; color: var(--color-earth); }
    .weights { display: grid; gap: 8px; }
    .weight {
      display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr) auto; grid-template-areas: 'photo rank rank' 'photo input unit';
      align-items: center; column-gap: 8px; row-gap: 4px; font-size: 0.85rem; color: var(--color-muted);
    }
    .balance, .no-photo { grid-area: photo; inline-size: 100%; block-size: 110px; border: 2px solid var(--color-card-edge); border-radius: 6px; }
    .balance { object-fit: cover; background: var(--color-desk); }
    .no-photo { display: grid; place-items: center; background: var(--color-slot); font-style: italic; text-align: center; }
    .rank { grid-area: rank; align-self: end; font-weight: 700; color: var(--color-earth); }
    .weight small { grid-area: unit; }
    .bounds { grid-column: 2 / -1; font-weight: 700; color: var(--color-alert); }
    .weight.out input { border-color: var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); }
    .weight input {
      grid-area: input; inline-size: 100%; min-block-size: 44px; box-sizing: border-box; padding: 4px 2px; text-align: center; border: 2px solid var(--color-card-edge); border-radius: 6px;
      background: var(--color-paper); color: var(--color-ink); font: 700 1rem var(--font-reading); font-variant-numeric: tabular-nums;
    }
    .weight input:focus-visible { outline: var(--focus-ring); outline-offset: 1px; }
    .average { margin: 10px 0 0; font: 700 1.1rem var(--font-hand); color: var(--color-ink); }
    .problem { margin: 8px 0 0; padding: 6px 10px; border: 2px dashed var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    app-weight-chart { margin-block-end: 12px; }
    .curve { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
    .curve li { display: flex; align-items: baseline; gap: 10px; padding: 8px 12px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); }
    .curve .day { min-inline-size: 64px; font-weight: 700; color: var(--color-earth); }
    .curve strong { font: 700 1.1rem var(--font-hand); font-variant-numeric: tabular-nums; }
    .curve small { color: var(--color-muted); }
    .none { display: flex; align-items: center; gap: 10px; color: var(--color-muted); font-style: italic; }
    .none app-pictogram { inline-size: 26px; block-size: 26px; }
    a:focus-visible, button:focus-visible, .lot:has(input:focus-visible), .tile:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class WeighingsPage {
  protected readonly weighings = inject(Weighings);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);

  protected readonly lots = this.office.lots;
  protected readonly lotId = currentLotOf(this.office, this.route);
  protected readonly when = signal<'today' | 'tomorrow'>('today');
  protected readonly asking = signal(false);
  protected readonly askWords = signal<string | null>(null);
  protected readonly askFailed = signal(false);
  /** The weights as typed, per weighing: what « Valider » writes. */
  private readonly drafts = signal<ReadonlyMap<string, Draft>>(new Map());
  protected readonly grams = grams;

  /** The photos of the scale shown, by fingerprint (T.6): read once, released when the page closes. */
  protected readonly photoUrls = signal<ReadonlyMap<string, string>>(new Map());
  private readonly destroyRef = inject(DestroyRef);

  protected readonly strain = computed(() => strainOf(this.weighings.view()?.strain ?? ''));

  constructor() {
    effect(() => {
      const lot = this.lotId();
      if (lot !== '') untracked(() => void this.reload(lot));
    });
    effect(() => {
      const fingerprints = (this.weighings.view()?.toValidate ?? []).flatMap((weighing) => weighing.photos ?? []);
      untracked(() => void this.showPhotos(fingerprints));
    });
    this.destroyRef.onDestroy(() => this.photoUrls().forEach((url) => URL.revokeObjectURL(url)));
  }

  private async showPhotos(fingerprints: readonly string[]): Promise<void> {
    const missing = [...new Set(fingerprints)].filter((fingerprint) => !this.photoUrls().has(fingerprint));
    const read = await Promise.all(missing.map(async (fingerprint) => [fingerprint, await this.weighings.photo(fingerprint)] as const));
    this.photoUrls.update((urls) => new Map([...urls, ...read.filter((pair): pair is readonly [string, string] => pair[1] !== null)]));
  }

  protected day(on: string): string {
    return dayWords(on);
  }

  protected draftOf(weighing: WeighingToValidate): Draft {
    return this.drafts().get(weighing.weighingId) ?? { typed: weighing.weights.map(String), problem: null, sending: false };
  }

  protected retype(weighing: WeighingToValidate, index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    const draft = this.draftOf(weighing);
    this.setDraft(weighing, { ...draft, typed: draft.typed.map((typed, at) => (at === index ? value : typed)), problem: null });
  }

  /** The average of the weights as typed, by the domain's rule; `null` while one is not a weight. */
  protected averageOf(weighing: WeighingToValidate): number | null {
    const weights = this.weightsOf(weighing);
    return weights === null ? null : averageWeight(weights);
  }

  /**
   * A weight far from the strain's target that day — the caretaker's bounds (T.3) — is shown red:
   * it alerts, it does not block (the photo decides).
   */
  protected outOfBounds(weighing: WeighingToValidate, typed: string): boolean {
    const strain = this.strain();
    if (strain === null || !/^\d+$/.test(typed)) return false;
    return outOfBounds(strain, weighing.campaignDay, Number(typed));
  }

  protected targetOn(campaignDay: number): number | null {
    const strain = this.strain();
    return strain === null ? null : (targetAt(strain, campaignDay)?.weight ?? null);
  }

  protected async ask(): Promise<void> {
    const view = this.weighings.view();
    const today = this.office.sites().find(({ siteId }) => siteId === view?.siteId)?.today;
    if (view === null || today === undefined || this.asking()) return;
    const requestedFor = this.when() === 'today' ? today : nextDay(today);
    this.asking.set(true);
    const problem = await this.weighings.ask({ id: crypto.randomUUID(), campaignId: view.campaignId, requestedFor });
    this.asking.set(false);
    this.askFailed.set(problem !== null);
    this.askWords.set(problem ?? `Demandée pour le ${dayWords(requestedFor)} : le gardien verra la carte pesée ce jour-là.`);
    if (problem === null) await this.weighings.load(view.campaignId);
  }

  protected async validate(weighing: WeighingToValidate): Promise<void> {
    const view = this.weighings.view();
    const weights = this.weightsOf(weighing);
    const draft = this.draftOf(weighing);
    if (view === null || weights === null || draft.sending) return;
    this.setDraft(weighing, { ...draft, sending: true, problem: null });
    const problem = await this.weighings.validate(view, weighing, weights);
    this.setDraft(weighing, { ...this.draftOf(weighing), sending: false, problem });
    if (problem === null) await this.reload(view.campaignId);
  }

  private weightsOf(weighing: WeighingToValidate): Weight[] | null {
    const weights: Weight[] = [];
    for (const typed of this.draftOf(weighing).typed) {
      const weight = /^\d+$/.test(typed) ? Weight(Number(typed)) : null;
      if (weight === null || !weight.ok) return null;
      weights.push(weight.value);
    }
    return weights;
  }

  private setDraft(weighing: WeighingToValidate, draft: Draft): void {
    this.drafts.update((drafts) => new Map(drafts).set(weighing.weighingId, draft));
  }

  private async reload(campaignId: string): Promise<void> {
    this.drafts.set(new Map());
    await this.weighings.load(campaignId);
  }
}
