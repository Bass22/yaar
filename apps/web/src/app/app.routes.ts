import type { Route } from '@angular/router';
import { caretakerRoutes } from './caretaker/caretaker.routes';
import { canEnter, toHome } from './core/session/guards';
import { NotificationLanding } from './core/push/notification-landing';
import { SignInPage } from './core/session/sign-in';

// The sign-in and the caretaker's notebook come with the first files (Z.1): on a phone in 3G, finding
// them only once the route matches costs one or two more round trips — up to a second of start. The
// office stays loaded on demand: the caretaker's phone never downloads it.
export const appRoutes: Route[] = [
  { path: 'sign-in', component: SignInPage },
  // A tap on a notification (Y.4): a closed list of kinds, else the home of the session.
  { path: 'notification', component: NotificationLanding },
  { path: 'caretaker', canMatch: [canEnter('caretaker')], children: caretakerRoutes },
  { path: 'admin', canMatch: [canEnter('admin')], loadChildren: () => import('./admin/admin.routes') },
  { path: '**', canMatch: [toHome], children: [] },
];
