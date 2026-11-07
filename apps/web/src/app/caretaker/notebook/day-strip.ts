import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Pictogram } from '../../ui/pictogram';
import type { NotebookCampaign } from './notebook-view';

/** The length of the gauge, from chick to hen: a broiler's usual cycle, until the strain (N.4) gives its own. */
export const GAUGE_DAYS = 42;

// The strip of the day (J.1, journal-gardien.html .strip-jour): day J, the gauge from chick to
// hen, and the birds alive — only once known: unknown is not zero (CLAUDE.md §4 rule 10). With
// several campaigns, it says again which one the notebook writes on.
@Component({
  selector: 'app-day-strip',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="strip" [attr.aria-label]="words()">
      <span class="day">Jour {{ campaign().campaignDay }}</span>
      <span class="growth" aria-hidden="true">
        <app-pictogram class="chick" picto="chick" [decorative]="true" />
        <span class="bar"><i [style.transform]="'scaleX(' + growth() + ')'"></i></span>
        <app-pictogram class="hen" picto="hen" [decorative]="true" />
      </span>
      @if (liveCount() !== null) {
        <span class="alive" aria-hidden="true"><app-pictogram picto="hen" [decorative]="true" /> {{ liveCount() }}</span>
      }
    </div>
    @if (campaign().name !== null) {
      <p class="campaign" [class]="'campaign ' + campaign().tone"><app-pictogram [picto]="campaign().picto" [decorative]="true" /> {{ campaign().name }} · J{{ campaign().campaignDay }}</p>
    }
  `,
  styles: `
    :host { display: block; }
    .strip {
      display: flex; align-items: center; gap: 10px; padding: 8px 12px;
      background: var(--color-paper); border: 2px solid var(--color-card-edge); box-shadow: var(--shadow-hard-sm); transform: rotate(-0.3deg);
    }
    .day { flex: none; font: 700 1.25rem var(--font-hand); color: var(--color-earth); }
    .growth { flex: 1; min-inline-size: 0; display: flex; align-items: center; gap: 5px; }
    .chick { inline-size: 23px; block-size: 23px; flex: none; }
    .hen { inline-size: 27px; block-size: 27px; flex: none; }
    .bar { flex: 1; min-inline-size: 24px; block-size: 10px; overflow: hidden; background: var(--color-slot); border-radius: 6px 8px 7px 9px; }
    .bar i { display: block; block-size: 100%; background: var(--color-corn); transform-origin: left center; }
    .alive { flex: none; display: flex; align-items: center; gap: 5px; font: 700 1.2rem var(--font-hand); color: var(--color-pasture); }
    .alive app-pictogram { inline-size: 28px; block-size: 28px; }
    .campaign {
      display: inline-flex; align-items: center; gap: 8px; margin: 10px 0 0; padding: 4px 12px;
      font: 700 1rem var(--font-hand); color: var(--color-ink); background: var(--color-post-it); border: 3px solid var(--color-campaign-young); transform: rotate(-2deg);
    }
    .campaign.old { border-color: var(--color-campaign-old); }
    .campaign app-pictogram { inline-size: 26px; block-size: 26px; }
  `,
})
export class DayStrip {
  readonly campaign = input.required<NotebookCampaign>();
  readonly liveCount = input<number | null>(null);

  /** How far from chick to hen, for the gauge only: drawn between empty and full. */
  protected readonly growth = computed(() => Math.min(1, Math.max(0, this.campaign().campaignDay / GAUGE_DAYS)));
  protected readonly words = computed(() => {
    const campaign = this.campaign();
    const alive = this.liveCount() === null ? '' : `, ${this.liveCount()} vivants`;
    return `${campaign.name === null ? '' : `${campaign.name}, `}jour ${campaign.campaignDay} de la bande${alive}`;
  });
}
