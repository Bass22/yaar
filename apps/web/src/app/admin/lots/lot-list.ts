import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { Pictogram } from '../../ui/pictogram';
import { Office, type OfficeLot } from '../office';

// The running lots, one line each (bureau-admin-v2.html, « le lot comme unité »): its site, its
// day, its live count — or that the live count is not known yet, never a zero.
@Component({
  selector: 'app-lot-list',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lots().length === 0) {
      <p class="none"><app-pictogram picto="barn" [decorative]="true" /> Aucun lot en cours.</p>
    } @else {
      <ul>
        @for (lot of lots(); track lot.campaignId) {
          <li>
            <!-- Touching a lot makes it the one the office works on (O.6). -->
            <button type="button" class="lot" [class.current]="lot.campaignId === office.currentLot()?.campaignId" [attr.aria-pressed]="lot.campaignId === office.currentLot()?.campaignId" (click)="office.chooseLot(lot.campaignId)">
              <app-pictogram picto="chick" [decorative]="true" />
              <span class="where">{{ lot.siteName }}</span>
              <span class="day">{{ lot.dayLabel }}</span>
              <span class="alive">{{ lot.liveCount === null ? 'vivants : aucun poussin reçu' : thousands(lot.liveCount) + ' vivants' }}</span>
            </button>
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; }
    ul { list-style: none; margin: 0; padding: 0; }
    .lot {
      inline-size: 100%; border: none; border-inline-start: 4px solid transparent; background: none; font: inherit; color: inherit; text-align: start; cursor: pointer;
      display: grid; grid-template-columns: 34px 1fr auto; grid-template-areas: 'picto where day' 'picto alive alive';
      align-items: center; column-gap: 10px; padding: 10px 4px; border-block-end: 1px dashed var(--color-card-edge);
    }
    .lot.current { border-inline-start-color: var(--color-pasture); background: var(--color-pasture-light); }
    .lot:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .lot app-pictogram { grid-area: picto; inline-size: 32px; block-size: 32px; }
    .where { grid-area: where; font-weight: 700; }
    .day { grid-area: day; font: 700 1rem var(--font-hand); color: var(--color-earth); font-variant-numeric: tabular-nums; }
    .alive { grid-area: alive; color: var(--color-muted); font-variant-numeric: tabular-nums; }
    .none { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 0; color: var(--color-muted); font-style: italic; }
    .none app-pictogram { inline-size: 30px; block-size: 30px; }
  `,
})
export class LotList {
  /** « 1 898 », never split across two lines. */
  protected thousands(value: number): string {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  }

  protected readonly office = inject(Office);
  readonly lots = input.required<readonly OfficeLot[]>();
}
