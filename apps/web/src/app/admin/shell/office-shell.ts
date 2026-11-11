import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { PictogramName } from '@design-system';
import { Pictogram } from '../../ui/pictogram';
import { Office } from '../office';
import { Purchases } from '../purchases/purchases';

type Tab = { readonly path: string; readonly label: string; readonly picto: PictogramName };

/** The bar at the bottom (bureau-admin-v2.html, validated on 2026-11-08): a real object and its word, each. */
const TABS: readonly Tab[] = [
  { path: 'accueil', label: 'Accueil', picto: 'bell' },
  { path: 'lots', label: 'Lots', picto: 'barn' },
  { path: 'achats', label: 'Achats', picto: 'truck' },
  { path: 'tiers', label: 'Tiers', picto: 'coin' },
  { path: 'plus', label: 'Plus', picto: 'paper' },
];

// The office (O.3): phone first — the kraft header, the page, the bar of five at the bottom.
// Offline, it shows the last reading kept and says how old its figures are.
@Component({
  selector: 'app-office-shell',
  imports: [Pictogram, RouterLink, RouterLinkActive, RouterOutlet],
  providers: [Office, Purchases],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <app-pictogram picto="barn" [decorative]="true" />
      <span class="who">Le bureau de {{ office.account()?.name }}</span>
    </header>
    @if (stale(); as when) {
      <p class="stale" role="status"><app-pictogram picto="sync-cloud" [decorative]="true" /> Pas de réseau : chiffres lus le {{ when }}</p>
    }
    <main class="page"><router-outlet /></main>
    <nav class="tabs" aria-label="Le bureau">
      @for (tab of tabs; track tab.path) {
        <a [routerLink]="tab.path" routerLinkActive="active" ariaCurrentWhenActive="page"><app-pictogram [picto]="tab.picto" [decorative]="true" /> {{ tab.label }}</a>
      }
    </nav>
  `,
  styles: `
    /* The bar of five is fixed: a page that keeps something at the bottom sits above it. */
    :host { --office-tabs-block-size: 65px; display: block; min-block-size: 100dvh; background: var(--color-shell); }
    .head {
      display: flex; align-items: center; gap: 10px; padding: 14px 16px;
      background: linear-gradient(180deg, var(--color-kraft), var(--color-kraft-dark)); color: var(--color-on-sign);
      font: 700 1.2rem var(--font-hand);
    }
    .head app-pictogram { inline-size: 34px; block-size: 34px; }
    .stale { display: flex; align-items: center; gap: 8px; margin: 0; padding: 8px 16px; background: var(--color-post-it); color: var(--color-earth); font-weight: 700; }
    .stale app-pictogram { inline-size: 26px; block-size: 26px; flex: none; }
    .page { padding: 12px 16px 96px; background-image: var(--notebook-lines); }
    .tabs {
      position: fixed; z-index: 2; inset-inline: 0; inset-block-end: 0; display: grid; grid-template-columns: repeat(5, 1fr);
      background: var(--color-paper); border-block-start: 3px solid var(--color-kraft);
    }
    .tabs a {
      display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-block-size: calc(var(--office-tabs-block-size) - 3px);
      color: var(--color-muted); font: 700 0.75rem var(--font-reading); text-decoration: none;
    }
    .tabs a app-pictogram { inline-size: 28px; block-size: 28px; opacity: 0.6; }
    .tabs a.active { color: var(--color-earth); background: var(--color-straw); }
    .tabs a.active app-pictogram { opacity: 1; }
    .tabs a:focus-visible { outline: var(--focus-ring); outline-offset: -4px; }
  `,
})
export class OfficeShell {
  protected readonly office = inject(Office);
  protected readonly tabs = TABS;

  /** « 5 nov. à 17:30 », only when the reading shown is not today's answer. */
  protected readonly stale = computed(() => {
    const read = this.office.readAt();
    if (!this.office.unreachable() || read === null) {
      return null;
    }
    const at = new Date(read.at);
    const day = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: read.timeZone }).format(at);
    const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: read.timeZone }).format(at);
    return `${day} à ${time}`;
  });
}
