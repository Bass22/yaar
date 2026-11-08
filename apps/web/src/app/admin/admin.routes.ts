import type { Route } from '@angular/router';
import { HomePage } from './home/home-page';
import { LotsPage } from './lots/lots-page';
import { MorePage } from './more/more-page';
import { OfficeShell } from './shell/office-shell';
import { ComingSoon } from './soon/coming-soon';

// The admin's office: loaded on its own, never with the caretaker's notebook (CLAUDE.md §3).
// Its bar of five follows bureau-admin-v2.html, validated on 2026-11-08 (O.3).
export const adminRoutes: Route[] = [
  {
    path: '',
    component: OfficeShell,
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'accueil' },
      { path: 'accueil', component: HomePage },
      { path: 'lots', component: LotsPage },
      { path: 'achats', component: ComingSoon, data: { title: 'Achats', picto: 'truck', words: 'Les commandes et les réceptions arrivent bientôt dans le bureau.' } },
      { path: 'tiers', component: ComingSoon, data: { title: 'Tiers', picto: 'coin', words: 'Qui doit quoi, fournisseurs et clients, arrive bientôt dans le bureau.' } },
      { path: 'plus', component: MorePage },
    ],
  },
];

export default adminRoutes;
