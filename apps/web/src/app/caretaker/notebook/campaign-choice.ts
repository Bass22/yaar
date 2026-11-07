import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Pictogram } from '../../ui/pictogram';
import type { NotebookCampaign } from './notebook-view';

// Several campaigns on the site (J.1, journal-gardien-entree.html screens 6 and 7): at opening, one
// big card per campaign — what the caretaker sees in the barn, chicks or hens, and their age —; once
// chosen, the campaigns become the tabs of the notebook. One campaign: neither exists.
@Component({
  selector: 'app-campaign-choice',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chosen() === null) {
      <section class="cards" aria-label="Choisir la bande">
        @for (campaign of campaigns(); track campaign.campaignId) {
          <button type="button" class="card" [class]="'card ' + campaign.tone" (click)="choose.emit(campaign.campaignId)">
            <app-pictogram class="big" [picto]="campaign.picto" [decorative]="true" />
            <span class="name">{{ campaign.name }}</span>
            <span class="day">Jour {{ campaign.campaignDay }}</span>
          </button>
        }
      </section>
    } @else {
      <nav class="tabs" role="tablist" aria-label="Choisir la bande">
        @for (campaign of campaigns(); track campaign.campaignId) {
          <button
            type="button"
            role="tab"
            [class]="'tab ' + campaign.tone"
            [class.active]="campaign.campaignId === chosen()"
            [attr.aria-selected]="campaign.campaignId === chosen()"
            [attr.aria-label]="campaign.name + ', jour ' + campaign.campaignDay"
            (click)="choose.emit(campaign.campaignId)"
          >
            <app-pictogram [picto]="campaign.picto" [decorative]="true" /><b>J{{ campaign.campaignDay }}</b>
          </button>
        }
      </nav>
    }
  `,
  styles: `
    :host { display: block; }
    .cards { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 22px 14px; }
    .card {
      inline-size: min(250px, 100%); padding: 14px; display: grid; grid-template-columns: auto 1fr; column-gap: 12px; align-items: center; text-align: start;
      background: var(--color-paper); border: 3px solid var(--color-ink); border-inline-start-width: 16px; box-shadow: var(--shadow-hard);
      border-radius: var(--radius-wobble-1); cursor: pointer;
    }
    .card:nth-child(2) { border-radius: var(--radius-wobble-2); }
    .card:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .card.young { border-inline-start-color: var(--color-campaign-young); }
    .card.old { border-inline-start-color: var(--color-campaign-old); }
    .big { inline-size: 64px; block-size: 64px; grid-row: 1 / 3; }
    .name { font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .day { font: 700 1rem var(--font-hand); color: var(--color-muted); }
    .tabs { display: flex; gap: 6px; padding: 8px 12px 0; background: var(--color-shell); }
    .tab {
      display: flex; align-items: center; gap: 6px; min-block-size: var(--touch-target-min); padding: 6px 14px 8px;
      border: 2px solid var(--color-card-edge); border-block-end: none; border-radius: 12px 16px 0 0;
      font: 700 1.05rem var(--font-hand); color: var(--color-ink); opacity: 0.75; transform: translateY(4px); cursor: pointer;
    }
    .tab app-pictogram { inline-size: 28px; block-size: 28px; }
    .tab.young { background: var(--color-post-it); border: 3px solid var(--color-campaign-young); border-block-end: none; }
    .tab.old { background: var(--color-campaign-old); color: var(--color-on-sign); }
    .tab.active { opacity: 1; transform: none; box-shadow: var(--shadow-hard-sm); }
    .card:focus-visible, .tab:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class CampaignChoice {
  readonly campaigns = input.required<readonly NotebookCampaign[]>();
  readonly chosen = input<string | null>(null);
  readonly choose = output<string>();
}
