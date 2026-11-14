import { ChangeDetectionStrategy, Component, computed, inject, signal, type Signal } from '@angular/core';
import type { ActivatedRoute } from '@angular/router';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';

/**
 * The lot a page works on (O.6): the office's current lot; an address that names one (`?lot=…`,
 * from a link) makes it the current lot.
 */
export function currentLotOf(office: Office, route: ActivatedRoute): Signal<string> {
  const asked = route.snapshot.queryParamMap.get('lot');
  if (asked !== null) office.chooseLot(asked);
  return computed(() => office.currentLot()?.campaignId ?? '');
}

// The lot a page works on, always named (O.6, bureau-admin-v2.html « Changer de lot »): one
// choice, kept, changed here — never a choice to make again on every page.
@Component({
  selector: 'app-current-lot',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (office.currentLot(); as lot) {
      <div class="current-lot">
        <p class="name"><app-pictogram picto="chick" [decorative]="true" /> <span>{{ lot.siteName }} · {{ lot.dayLabel }}</span></p>
        @if (office.lots().length > 1) {
          <button type="button" class="change" [attr.aria-expanded]="open()" (click)="open.set(!open())">Changer de lot</button>
        }
      </div>
      @if (open()) {
        <div class="lots" role="radiogroup" aria-label="Quel lot ?">
          @for (other of office.lots(); track other.campaignId) {
            <label class="lot">
              <input type="radio" name="lot" [checked]="other.campaignId === lot.campaignId" (change)="choose(other.campaignId)" />
              {{ other.siteName }} · {{ other.dayLabel }}
            </label>
          }
        </div>
      }
    } @else {
      <p class="none">Aucun lot en cours.</p>
    }
  `,
  styles: `
    :host { display: block; margin-block-end: 10px; }
    .current-lot { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .name { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1.1rem var(--font-hand); color: var(--color-ink); }
    .name app-pictogram { inline-size: 28px; block-size: 28px; }
    .change { min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; background: var(--color-paper); color: var(--color-earth); font-weight: 700; cursor: pointer; }
    .lots { display: flex; flex-wrap: wrap; gap: 8px; margin-block-start: 8px; }
    .lot { position: relative; display: inline-flex; align-items: center; min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: 999px; font-weight: 700; color: var(--color-earth); cursor: pointer; }
    .lot input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
    .lot:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .none { margin: 0; color: var(--color-muted); }
    .change:focus-visible, .lot:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class CurrentLot {
  protected readonly office = inject(Office);
  protected readonly open = signal(false);

  protected choose(campaignId: string): void {
    this.office.chooseLot(campaignId);
    this.open.set(false);
  }
}
