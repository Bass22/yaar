import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { PushNotifications } from '../../core/push/push-notifications';
import { AuthService } from '../../core/session/auth';
import { Pictogram } from '../../ui/pictogram';

// « Plus »: the settings of the farm (bureau-admin-v2.html): the price catalogue (N.5), the
// notifications of this device (Y.1). « Sites et équipe » is still a label, not a screen of its own.
@Component({
  selector: 'app-more-page',
  imports: [Pictogram, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Réglages</h1>
    <ul class="settings">
      <li><app-pictogram picto="barn" [decorative]="true" /> Sites et équipe</li>
      <li><a class="prices" routerLink="prix"><app-pictogram picto="coin" [decorative]="true" /> Prix habituels</a></li>
      <!-- Y.1: the agreement is given here on the office side; nothing when the browser or the server cannot -->
      @if (push.state() !== 'none' && push.state() !== 'loading') {
        <li class="push">
          <app-pictogram picto="bell" [decorative]="true" />
          <span class="push-words">Notifications sur cet appareil</span>
          @switch (push.state()) {
            @case ('on') { <span class="push-state">Activées</span> }
            @case ('denied') { <span class="push-state">Refusées dans les réglages du navigateur : c'est là qu'elles se rouvrent</span> }
            @default { <button type="button" class="enable" (click)="push.agree()">Activer</button> }
          }
        </li>
      }
    </ul>
    <!-- The account's number and what waits to be sent stay on this computer: only the session closes. -->
    <button type="button" class="sign-out" (click)="signOut()">Se déconnecter</button>
  `,
  styles: `
    h1 { margin: 0 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: center; gap: 10px; min-block-size: 56px; border-block-end: 1px dashed var(--color-card-edge); font-weight: 700; }
    li app-pictogram { inline-size: 32px; block-size: 32px; flex: none; }
    .push { flex-wrap: wrap; padding-block: 6px; }
    .push-words { flex: 1; }
    .push-state { color: var(--color-muted); font-weight: 400; }
    .enable { min-block-size: 44px; padding: 0 14px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700; cursor: pointer; }
    .enable:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    li a { display: flex; align-items: center; gap: 10px; flex: 1; min-block-size: 56px; color: var(--color-ink); text-decoration: none; }
    li a:focus-visible, .sign-out:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .sign-out { margin-block-start: 24px; min-block-size: 48px; padding: 0 16px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
  `,
})
export class MorePage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly push = inject(PushNotifications);

  constructor() {
    void this.push.refresh();
  }

  /** The device's notifications stop first, while the session can still say so to the server (Y.1). */
  protected async signOut(): Promise<void> {
    await this.push.stop();
    this.auth.signOut();
    void this.router.navigate(['/sign-in']);
  }
}
