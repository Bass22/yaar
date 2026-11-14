import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { clip } from '../audio/phrase';
import type { ScriptClip } from '../audio/script-clips';
import { Voice } from '../audio/voice';
import { AuthService } from '../session/auth';
import { homeOf, mayEnter, type View } from '../session/guards';
import type { PushKind } from '@contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where each kind of notification leads, and what the voice says there: a closed list (Y.4). */
const TARGETS: Readonly<Record<PushKind, { readonly view: View; readonly path: string; readonly said?: ScriptClip }>> = {
  DeliveryAnnounced: { view: 'caretaker', path: '/caretaker', said: 'delivery-announced' },
  WeighingRequested: { view: 'caretaker', path: '/caretaker', said: 'weighing-requested' },
  // The morning reminder (Y.3) leads to the post-it « Rien perdu hier », whose phrase it says.
  MorningReminder: { view: 'caretaker', path: '/caretaker', said: 'nothing-lost-reminder' },
  CorrectionWritten: { view: 'admin', path: '/admin/accueil' },
  TooManyDeaths: { view: 'admin', path: '/admin/accueil' },
};

// A tap on a notification (Y.4): the service worker opens `/notification?kind=…&campaign=…`, even
// with the application closed. Only a kind of the list leads somewhere — with the flock it names,
// for the notebook — and the voice says its card; anything else opens the home of the session.
@Component({
  selector: 'app-notification-landing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class NotificationLanding {
  constructor() {
    const router = inject(Router);
    const voice = inject(Voice);
    const session = inject(AuthService).session();
    const params = inject(ActivatedRoute).snapshot.queryParamMap;
    const kind = params.get('kind') ?? '';
    const campaign = params.get('campaign') ?? '';
    const target = Object.hasOwn(TARGETS, kind) ? TARGETS[kind as PushKind] : undefined;
    if (target === undefined || !UUID.test(campaign) || !mayEnter(target.view, session) || homeOf(session) === '/sign-in' || (target.view === 'caretaker' && homeOf(session) !== '/caretaker')) {
      void router.navigateByUrl(homeOf(session), { replaceUrl: true });
      return;
    }
    void router.navigate([target.path], { replaceUrl: true, ...(target.view === 'caretaker' ? { queryParams: { campaign } } : {}) });
    if (target.said !== undefined) void voice.say([clip(target.said)]);
  }
}
