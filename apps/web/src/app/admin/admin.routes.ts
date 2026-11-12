import type { Route } from '@angular/router';
import { BudgetPage } from './budget/budget-page';
import { ClosedLotsPage } from './closing/closed-lots-page';
import { ClosingPage } from './closing/closing-page';
import { ClosingReportPage } from './closing/closing-report-page';
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
import { SaleGesturePage } from './sales/sale-gesture-page';
import { SalePage } from './sales/sale-page';
import { SalesPage } from './sales/sales-page';
import { TrackingPage } from './tracking/tracking-page';
import { WeighingsPage } from './weighings/weighings-page';
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
      { path: 'lots/ventes', component: SalesPage },
      { path: 'lots/pesees', component: WeighingsPage },
      { path: 'lots/suivi', component: TrackingPage },
      { path: 'lots/budget', component: BudgetPage },
      { path: 'lots/cloture', component: ClosingPage },
      { path: 'lots/clos', component: ClosedLotsPage },
      { path: 'lots/bilan/:id', component: ClosingReportPage },
      { path: 'lots/vente', component: SaleGesturePage },
      { path: 'lots/ventes/:id', component: SalePage },
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
