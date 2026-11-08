import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Pictogram } from '../../ui/pictogram';
import { LotList } from '../lots/lot-list';
import { Office } from '../office';

// The office's home (bureau-admin-v2.html): one line per running lot, then what waits for the
// chef, the most urgent first. What waits arrives with O.4 (refusals, alerts) and U (the inbox).
@Component({
  selector: 'app-home-page',
  imports: [LotList, Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-lot-list [lots]="office.lots()" />
    <h1><app-pictogram picto="bell" [decorative]="true" /> À traiter</h1>
    <p class="nothing"><app-pictogram picto="round-check" [decorative]="true" /> Rien à traiter pour l’instant.</p>
  `,
  styles: `
    h1 { display: flex; align-items: center; gap: 8px; margin: 16px 0 6px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 28px; block-size: 28px; }
    .nothing { display: flex; align-items: center; gap: 10px; margin: 0; color: var(--color-muted); font-style: italic; }
    .nothing app-pictogram { inline-size: 30px; block-size: 30px; }
  `,
})
export class HomePage {
  protected readonly office = inject(Office);
}
