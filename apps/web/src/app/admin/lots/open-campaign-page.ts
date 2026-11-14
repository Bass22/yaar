import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { CampaignOpeningRefusal, OpenCampaignRequest } from '@contracts';
import { addDays, BusinessDay, DEFAULT_PLANNED_DURATION, MAX_CAMPAIGN_DAYS, MAX_DAYS_AHEAD, STRAINS, validateCampaignOpening, type Species } from '@domain/journal';
import { AuthService } from '../../core/session/auth';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { grouped, typedNumber, typedText } from '../typed-number';
import { Affixed } from '../../ui/affixed';

type Problem = CampaignOpeningRefusal['kind'] | 'NoSite' | 'NoNetwork' | 'ServerError';

const WORDS: Record<Problem, string> = {
  NoSite: 'Choisis le site de la bande.',
  InvalidRequest: 'Le formulaire est incomplet.',
  UnknownStrain: 'Cette souche n’est pas connue.',
  InvalidQuantity: 'L’effectif prévu doit être d’au moins 1 poussin.',
  InvalidBusinessDay: 'La date de mise en place n’est pas une date.',
  PlacementTooFarAhead: 'La mise en place est au plus dans 30 jours.',
  PlacementTooOld: 'La mise en place date de plus de 60 jours : cette bande serait déjà finie.',
  InvalidPlannedDuration: 'La durée prévue va de 1 à 60 jours.',
  SiteNotFound: 'Ce site n’existe plus.',
  CampaignAlreadyExists: 'Le serveur n’a pas pu ouvrir la bande. Réessaie.',
  NoNetwork: 'Pas de réseau : la bande n’est pas ouverte. Réessaie avec le réseau.',
  ServerError: 'Le serveur n’a pas pu ouvrir la bande. Réessaie.',
};

/**
 * Opening a campaign at the office (O.2), online. Prefilled to save the admin's time (founder's
 * request, 2026-11-09): the only site, the Cobb 500 strain, placed today, 45 days. The domain's
 * rule judges before sending — the same code as the server, which still decides.
 */
@Component({
  selector: 'app-open-campaign-page',
  imports: [Affixed, Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="chick" [decorative]="true" /> Ouvrir une bande</h1>
    <!-- novalidate: the domain judges, and says why in words; the browser would block silently. -->
    <form novalidate (submit)="$event.preventDefault(); open()">
      <fieldset>
        <legend><app-pictogram picto="barn" [decorative]="true" /> Où ?</legend>
        <div class="tiles">
          @for (site of sites(); track site.siteId) {
            <label class="tile">
              <input type="radio" name="site" [value]="site.siteId" [checked]="site.siteId === siteId()" (change)="siteId.set(site.siteId)" />
              <app-pictogram picto="barn" [decorative]="true" />
              <span class="name">{{ site.name }}</span>
            </label>
          }
        </div>
      </fieldset>

      <fieldset>
        <legend><app-pictogram picto="hen" [decorative]="true" /> Quelle souche ?</legend>
        <div class="tiles">
          @for (one of strains; track one.code) {
            <label class="tile">
              <input type="radio" name="strain" [value]="one.code" [checked]="one.code === strain()" (change)="strain.set(one.code)" />
              <app-pictogram picto="chick" [decorative]="true" />
              <span class="name">{{ one.name }}</span>
              <small>{{ speciesWords[one.species] }}</small>
            </label>
          }
        </div>
      </fieldset>

      <label class="question headcount">
        <span class="ask"><app-pictogram picto="chick" [decorative]="true" /> Combien de poussins ?</span>
        <span class="figure">
          <app-affixed [unit]="'poussins'"><input name="plannedHeadcount" type="text" inputmode="numeric" autocomplete="off" placeholder="—" [value]="grouped(headcount())" (input)="headcount.set(typedNumber($event))" /></app-affixed>
        </span>
      </label>

      <label class="question">
        <span class="ask"><app-pictogram picto="sun" [decorative]="true" /> Mis en place le</span>
        <input class="day" name="placementDay" type="date" [value]="placementDay()" [max]="latest() ?? ''" [min]="earliest() ?? ''" (input)="placementDay.set(valueOf($event))" />
      </label>

      <div class="question">
        <span class="ask" id="duration-label"><app-pictogram picto="moon" [decorative]="true" /> Pour combien de jours ?</span>
        <div class="duration">
          <button type="button" class="less" aria-label="Un jour de moins" [disabled]="durationDays() <= 1" (click)="step(-1)">−</button>
          <span class="figure">
            <input name="plannedDuration" type="number" inputmode="numeric" min="1" [max]="maxDays" step="1" aria-labelledby="duration-label" [value]="duration()" (input)="duration.set(valueOf($event))" />
            <span class="unit">jours</span>
          </span>
          <button type="button" class="more" aria-label="Un jour de plus" [disabled]="durationDays() >= maxDays" (click)="step(1)">+</button>
        </div>
      </div>

      @if (problem(); as problem) {
        <p class="refusal" role="alert"><app-pictogram picto="cross" [decorative]="true" /> {{ words[problem] }}</p>
      }
      <div class="actions">
        <a routerLink="..">Annuler</a>
        <button type="submit" class="go" [disabled]="sending()"><app-pictogram picto="check" [decorative]="true" /> Ouvrir la bande</button>
      </div>
    </form>
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 14px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    /* Room at the end for the action bar, fixed above the bar of five. */
    form { display: grid; gap: 18px; padding-block-end: 72px; }
    fieldset { margin: 0; padding: 0; border: 0; min-inline-size: 0; }
    legend, .ask { display: flex; align-items: center; gap: 8px; margin-block-end: 8px; padding: 0; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    legend app-pictogram, .ask app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }

    /* A choice is a tile with its picture (bureau-admin-v2.html, .tuile): one tap, never a drop-down. */
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; }
    .tile {
      position: relative; display: grid; grid-template-columns: 44px 1fr; grid-template-rows: auto auto; align-content: center; column-gap: 12px;
      min-block-size: 72px; padding: 10px 14px; cursor: pointer;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1);
      box-shadow: var(--shadow-hard-sm); color: var(--color-earth);
    }
    .tile:nth-child(even) { border-radius: var(--radius-wobble-2); }
    .tile input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .tile app-pictogram { grid-row: 1 / 3; align-self: center; inline-size: 44px; block-size: 44px; }
    .tile .name { align-self: end; font: 700 1.05rem var(--font-hand); }
    .tile .name:last-child { grid-row: 1 / 3; align-self: center; }
    .tile small { font: 0.85rem var(--font-reading); color: var(--color-muted); }
    .tile:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); box-shadow: var(--shadow-hard); }
    .tile:has(input:checked)::after {
      content: '✓'; position: absolute; inset-block-start: -10px; inset-inline-end: -8px; display: grid; place-items: center;
      inline-size: 28px; block-size: 28px; border-radius: var(--radius-blob); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700;
    }
    .tile:has(input:focus-visible) { outline: 4px solid var(--color-blue); outline-offset: 2px; }

    /* A figure is written large, on a line of the notebook. */
    .question { display: grid; }
    .figure { display: flex; align-items: baseline; justify-content: center; gap: 8px; padding-block-end: 4px; border-block-end: 2px solid var(--color-rule); }
    .figure input {
      inline-size: 7ch; min-inline-size: 0; padding: 0; border: 0; background: transparent; text-align: end; line-height: 1.2;
      font: 700 2.2rem var(--font-hand); color: var(--color-ink); font-variant-numeric: tabular-nums; appearance: textfield;
    }
    .figure input::-webkit-outer-spin-button, .figure input::-webkit-inner-spin-button { appearance: none; margin: 0; }
    .figure input::placeholder { color: var(--color-card-edge); }
    .figure .unit { flex: none; font: 700 1.05rem var(--font-hand); color: var(--color-earth); }
    .day {
      justify-self: start; min-block-size: 52px; padding: 0 14px; border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-3);
      background: var(--color-shell); color: var(--color-ink); font: 700 1.15rem var(--font-reading); box-shadow: var(--shadow-hard-sm);
    }
    .duration { display: grid; grid-template-columns: 56px 1fr 56px; align-items: center; gap: 12px; }
    .duration .figure input { inline-size: 3ch; }
    .less, .more {
      inline-size: 56px; block-size: 56px; border: 3px solid var(--color-ink); border-radius: var(--radius-blob);
      background: var(--color-shell); color: var(--color-ink); font: 700 1.8rem var(--font-hand); line-height: 1; box-shadow: var(--shadow-hard-sm);
    }
    .less:active, .more:active { transform: translate(1px, 2px); box-shadow: var(--shadow-hard-xs); }
    .less:disabled, .more:disabled { opacity: 0.35; }

    input:focus-visible, button:focus-visible, a:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .refusal { display: flex; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; border-inline-start: 5px solid var(--color-alert); background: var(--color-alert-light); color: var(--color-alert); font-weight: 700; }
    .refusal app-pictogram { inline-size: 24px; block-size: 24px; flex: none; }

    /* Always in sight, above the bar of five: the one action of the page. */
    .actions {
      position: fixed; inset-inline: 0; inset-block-end: var(--office-tabs-block-size, 0); z-index: 1; display: flex; justify-content: space-between; align-items: center; gap: 12px;
      padding: 10px 16px; background: var(--color-paper); border-block-start: 2px dashed var(--color-card-edge);
    }
    .actions a { min-block-size: 48px; display: inline-flex; align-items: center; padding-inline: 4px; color: var(--color-ink); font-weight: 700; }
    .go {
      display: inline-flex; align-items: center; gap: 8px; min-block-size: 56px; padding: 0 22px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .go app-pictogram { inline-size: 26px; block-size: 26px; }
    .go:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .go:disabled { opacity: 0.6; }
    @media (prefers-reduced-motion: reduce) { .go:active, .less:active, .more:active { transform: none; } }
  `,
})
export class OpenCampaignPage {
  protected readonly grouped = grouped;
  protected readonly typedNumber = typedNumber;
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  // The office lives under a prefix (/admin): every link is relative to this page's route.
  private readonly route = inject(ActivatedRoute);
  private readonly office = inject(Office);

  protected readonly strains = STRAINS;
  protected readonly words = WORDS;
  protected readonly maxDays = MAX_CAMPAIGN_DAYS;
  protected readonly sites = this.office.sites;

  /** The only site is chosen for the admin; with several, nothing is chosen ahead. */
  protected readonly siteId = linkedSignal(() => (this.sites().length === 1 ? (this.sites()[0]?.siteId ?? '') : ''));
  protected readonly strain = signal<string>('Cobb500');
  protected readonly headcount = signal('');
  protected readonly duration = signal(String(DEFAULT_PLANNED_DURATION));
  protected readonly durationDays = computed(() => Number(this.duration()) || 0);
  protected readonly speciesWords: Record<Species, string> = { Broiler: 'poulet de chair' };

  private readonly site = computed(() => this.sites().find(({ siteId }) => siteId === this.siteId()) ?? this.sites()[0] ?? null);
  /** The site's today: the day the domain judges on. */
  protected readonly today = computed(() => this.site()?.today ?? null);
  protected readonly earliest = computed(() => {
    const today = this.today();
    const day = today === null ? null : BusinessDay(today);
    return day?.ok ? addDays(day.value, -MAX_CAMPAIGN_DAYS) : null;
  });
  /** Opened ahead at most 30 days (O.5): the caretaker sees it from its day 0. */
  protected readonly latest = computed(() => {
    const today = this.today();
    const day = today === null ? null : BusinessDay(today);
    return day?.ok ? addDays(day.value, MAX_DAYS_AHEAD) : null;
  });
  protected readonly placementDay = linkedSignal(() => this.today() ?? '');

  protected readonly problem = signal<Problem | null>(null);
  protected readonly sending = signal(false);

  protected step(days: number): void {
    this.duration.set(String(Math.min(MAX_CAMPAIGN_DAYS, Math.max(1, Math.round(this.durationDays()) + days))));
  }

  protected valueOf(event: Event): string {
    return typedText(event);
  }

  protected async open(): Promise<void> {
    const session = this.auth.session();
    const today = this.today();
    if (this.sending() || session.status !== 'active') {
      return;
    }
    if (this.siteId() === '' || today === null) {
      this.problem.set('NoSite');
      return;
    }
    const request: OpenCampaignRequest = {
      id: crypto.randomUUID(),
      siteId: this.siteId(),
      strain: this.strain(),
      plannedHeadcount: this.headcount().trim() === '' ? 0 : Number(this.headcount()),
      placementDay: this.placementDay(),
      plannedDuration: Number(this.duration()),
    };
    const day = BusinessDay(today);
    const judged = day.ok ? validateCampaignOpening(request, day.value) : day;
    if (!judged.ok) {
      this.problem.set(judged.error.kind in WORDS ? (judged.error.kind as Problem) : 'InvalidRequest');
      return;
    }
    this.sending.set(true);
    this.problem.set(null);
    try {
      await firstValueFrom(this.http.post('/api/v1/campaigns', request, { headers: new HttpHeaders({ Authorization: `Bearer ${session.token}` }) }));
      await this.office.refresh();
      await this.router.navigate(['..'], { relativeTo: this.route });
    } catch (error) {
      this.problem.set(problemOf(error));
    } finally {
      this.sending.set(false);
    }
  }
}

function problemOf(error: unknown): Problem {
  if (!(error instanceof HttpErrorResponse) || error.status === 0) {
    return 'NoNetwork';
  }
  const kind = (error.error as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' && kind in WORDS ? (kind as Problem) : 'ServerError';
}
