import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService, type SignInFailure, type SignInResult } from './auth';

// A plain sign-in screen (G.2, decision of 2026-11-07): phone number and PIN, then the PIN of
// one's own at the first sign-in. The « cahier » screen — avatar, pictos, audio — comes with
// /designer and E.9.
@Component({
  selector: 'app-sign-in',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="sign-in">
      <h1>Connexion</h1>
      <form (submit)="submit($event)">
        <label>
          Numéro de téléphone
          <input name="phone" type="tel" autocomplete="tel" placeholder="+221771234567" [value]="phone()" (input)="phone.set(valueOf($event))" required />
        </label>
        <label>
          {{ choosing() ? 'PIN donné par le gérant' : 'Code PIN' }}
          <input name="pin" type="password" inputmode="numeric" autocomplete="current-password" [value]="pin()" (input)="pin.set(valueOf($event))" required />
        </label>
        @if (choosing()) {
          <label>
            Ton nouveau code PIN
            <input name="newPin" type="password" inputmode="numeric" autocomplete="new-password" [value]="newPin()" (input)="newPin.set(valueOf($event))" required />
          </label>
        }
        @if (message(); as text) {
          <p role="alert">{{ text }}</p>
        }
        <button type="submit" [disabled]="busy()">{{ choosing() ? 'Choisir mon PIN' : 'Entrer' }}</button>
      </form>
    </main>
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly phone = signal('');
  protected readonly pin = signal('');
  protected readonly newPin = signal('');
  protected readonly choosing = signal(false);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    this.busy.set(true);
    const result: SignInResult = this.choosing()
      ? await this.auth.choosePin(this.phone(), this.pin(), this.newPin())
      : await this.auth.signIn(this.phone(), this.pin());
    this.busy.set(false);
    if (result.ok) {
      await this.router.navigateByUrl(result.home);
      return;
    }
    if (result.refusal.kind === 'PinMustBeChosen') {
      this.choosing.set(true);
    }
    this.message.set(messageOf(result.refusal));
  }
}

function messageOf(refusal: SignInFailure): string {
  switch (refusal.kind) {
    case 'InvalidCredentials':
      return 'Numéro ou code PIN incorrect.';
    case 'TooManyAttempts':
      return `Trop d'essais. Réessaie à ${new Date(refusal.retryAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
    case 'AccountBlocked':
      return 'Ce compte est bloqué. Parle au gérant.';
    case 'PinMustBeChosen':
      return 'Première connexion : choisis ton propre code PIN.';
    case 'ProvisionalPinExpired':
      return 'Le PIN donné par le gérant a expiré. Demande-lui un nouveau PIN.';
    case 'PinAlreadyChosen':
      return 'Ton PIN est déjà choisi : connecte-toi avec lui.';
    case 'InvalidPin':
      return `Le PIN a ${refusal.expectedDigits} chiffres.`;
    case 'TrivialPin':
      return 'Ce PIN est trop simple : ni un chiffre répété, ni des chiffres qui se suivent.';
    case 'SameAsProvisionalPin':
      return 'Choisis un PIN différent de celui donné par le gérant.';
    case 'InvalidRequest':
      return 'Le numéro s’écrit en entier, par exemple +221771234567.';
    case 'Offline':
      return 'Pas de réseau : la connexion attendra le réseau.';
    case 'ServerUnavailable':
      return 'Le service ne répond pas. Réessaie plus tard.';
  }
}
