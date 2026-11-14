import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ClosedLotView } from '@contracts';
import { Pictogram } from '../../ui/pictogram';
import { Closing } from './closing';
import { dayWords } from '../typed-number';

// The closed lots (X.2): they stay readable, each leading to its report. Online only.
@Component({
  selector: 'app-closed-lots-page',
  imports: [Pictogram, RouterLink],
  providers: [Closing],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="stamp-done" [decorative]="true" /> Lots clôturés</h1>
    <a class="back" routerLink="/admin/lots">Revenir aux lots</a>
    @if (lots(); as closed) {
      @for (lot of closed; track lot.campaignId) {
        <a class="closed-lot" [routerLink]="['/admin/lots/bilan', lot.campaignId]">{{ lot.siteName }} · mise en place le {{ day(lot.placementDay) }}, close le {{ day(lot.closedAt.slice(0, 10)) }}</a>
      } @empty {
        <p class="none">Aucun lot clôturé.</p>
      }
    } @else if (unreachable()) {
      <p class="missing" role="alert">Pas de réseau : les lots clôturés se lisent en ligne. Réessaie plus tard.</p>
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; margin-block-end: 6px; color: var(--color-ink); font-weight: 700; }
    .closed-lot { display: flex; align-items: center; min-block-size: 52px; margin-block-start: 10px; padding: 6px 12px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); color: var(--color-ink); font-weight: 700; text-decoration: none; }
    .none { color: var(--color-muted); }
    .missing { padding: 10px; border-inline-start: 4px solid var(--color-orange); background: var(--color-orange-light); color: var(--color-earth); font-weight: 700; }
    a:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class ClosedLotsPage {
  private readonly closing = inject(Closing);
  protected readonly lots = signal<ClosedLotView[] | null>(null);
  protected readonly unreachable = signal(false);
  protected readonly day = dayWords;

  constructor() {
    void this.closing.closedLots().then((lots) => {
      this.lots.set(lots);
      this.unreachable.set(lots === null);
    });
  }
}
