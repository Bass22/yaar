import type { Route } from '@angular/router';
import { HomePage } from './home/home-page';
import { LotsPage } from './lots/lots-page';
import { OpenCampaignPage } from './lots/open-campaign-page';
import { OrderEditorPage } from './purchases/order-editor-page';
import { PaymentPage } from './purchases/payment-page';
import { PurchasesPage } from './purchases/purchases-page';
import { ExpenseGesturePage } from './money/expense-gesture-page';
import { ExpensesPage } from './money/expenses-page';
import { CounterpartyLedgerPage } from './money/counterparties/counterparty-ledger-page';
import { LedgerPage } from './money/counterparties/ledger-page';
import { MorePage } from './more/more-page';
import { OfficeShell } from './shell/office-shell';

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
      { path: 'lots/ouvrir', component: OpenCampaignPage },
      { path: 'achats', component: PurchasesPage },
      { path: 'achats/nouvelle', component: OrderEditorPage },
      // Before `achats/:id`, which would take them for an order.
      { path: 'achats/depenses', component: ExpensesPage },
      { path: 'achats/depense', component: ExpenseGesturePage },
      { path: 'achats/:id', component: OrderEditorPage },
      { path: 'achats/:id/payer', component: PaymentPage },
      { path: 'tiers', component: LedgerPage },
      { path: 'tiers/:id', component: CounterpartyLedgerPage },
      { path: 'plus', component: MorePage },
    ],
  },
];

export default adminRoutes;
