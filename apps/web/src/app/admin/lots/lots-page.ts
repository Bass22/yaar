import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Office } from '../office';
import { LotList } from './lot-list';

// « Lots »: every running lot of the farm. Opening one, with its own tabs, comes with O.4.
@Component({
  selector: 'app-lots-page',
  imports: [LotList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Lots en cours</h1><app-lot-list [lots]="office.lots()" />`,
  styles: `h1 { margin: 0 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }`,
})
export class LotsPage {
  protected readonly office = inject(Office);
}
