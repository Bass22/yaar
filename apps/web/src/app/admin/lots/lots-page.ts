import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Pictogram } from '../../ui/pictogram';
import { FiguresAge } from '../figures-age';
import { Office } from '../office';
import { DeathPhotos } from './death-photos';
import { LotList } from './lot-list';

// « Lots »: every running lot of the farm, and opening a new one (O.2). Opening a lot, with its
// own tabs, comes with O.4.
@Component({
  selector: 'app-lots-page',
  imports: [DeathPhotos, FiguresAge, LotList, Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!office.unreachable()) {
      <app-figures-age [readAt]="office.readAt()?.at ?? null" />
    }
    <h1>Lots en cours</h1>
    <app-lot-list [lots]="office.lots()" />
    @if (office.lots().length > 0) {
      <a class="sales" routerLink="ventes"><app-pictogram picto="hen" [decorative]="true" /> Les ventes</a>
      <a class="weighings" routerLink="pesees"><app-pictogram picto="scale" [decorative]="true" /> Les pesées</a>
      <a class="tracking" routerLink="suivi"><app-pictogram picto="paper" [decorative]="true" /> Le suivi</a>
    }
    @for (lot of office.lots(); track lot.campaignId) {
      @if (office.lots().length > 1) {
        <h3 class="lot-name">{{ lot.siteName }} · Jour {{ lot.campaignDay }}</h3>
      }
      <app-death-photos [campaignId]="lot.campaignId" />
    }
    <a class="open-campaign" routerLink="ouvrir"><app-pictogram picto="chick" [decorative]="true" /> Ouvrir une bande</a>
  `,
  styles: `
    .lot-name { margin: 16px 0 -8px; font: 700 1rem var(--font-hand); color: var(--color-muted); }
    h1 { margin: 0 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .open-campaign {
      display: flex; align-items: center; justify-content: center; gap: 8px; margin-block-start: 16px; min-block-size: 52px;
      border: 2px dashed var(--color-card-edge); border-radius: 4px; color: var(--color-ink); font-weight: 700; text-decoration: none;
    }
    .open-campaign:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .sales, .weighings, .tracking {
      display: flex; align-items: center; justify-content: center; gap: 8px; margin-block-start: 16px; min-block-size: 56px; text-decoration: none;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.1rem var(--font-hand);
    }
    .weighings { background: var(--color-blue); }
    .tracking { background: var(--color-earth); }
    .sales app-pictogram, .weighings app-pictogram, .tracking app-pictogram { inline-size: 28px; block-size: 28px; }
    .sales:focus-visible, .weighings:focus-visible, .tracking:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .open-campaign app-pictogram { inline-size: 28px; block-size: 28px; }
  `,
})
export class LotsPage {
  protected readonly office = inject(Office);
}
