import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { LotList } from './lot-list';

// « Lots »: every running lot of the farm, and opening a new one (O.2). Opening a lot, with its
// own tabs, comes with O.4.
@Component({
  selector: 'app-lots-page',
  imports: [LotList, Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Lots en cours</h1>
    <app-lot-list [lots]="office.lots()" />
    <a class="open-campaign" routerLink="ouvrir"><app-pictogram picto="chick" [decorative]="true" /> Ouvrir une bande</a>
  `,
  styles: `
    h1 { margin: 0 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .open-campaign {
      display: flex; align-items: center; justify-content: center; gap: 8px; margin-block-start: 16px; min-block-size: 52px;
      border: 2px dashed var(--color-card-edge); border-radius: 4px; color: var(--color-ink); font-weight: 700; text-decoration: none;
    }
    .open-campaign:focus-visible { outline: 4px solid var(--color-blue); outline-offset: 2px; }
    .open-campaign app-pictogram { inline-size: 28px; block-size: 28px; }
  `,
})
export class LotsPage {
  protected readonly office = inject(Office);
}
