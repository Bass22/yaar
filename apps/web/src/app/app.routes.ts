import type { Route } from '@angular/router';
import { canEnter, toHome } from './core/session/guards';

// Each view is loaded on demand: the caretaker's phone never downloads the admin's office.
export const appRoutes: Route[] = [
  { path: 'sign-in', loadComponent: () => import('./core/session/sign-in').then((page) => page.SignInPage) },
  { path: 'caretaker', canMatch: [canEnter('caretaker')], loadChildren: () => import('./caretaker/caretaker.routes') },
  { path: 'admin', canMatch: [canEnter('admin')], loadChildren: () => import('./admin/admin.routes') },
  { path: '**', canMatch: [toHome], children: [] },
];
