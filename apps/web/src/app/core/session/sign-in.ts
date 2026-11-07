import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AvatarBadge } from '../../ui/avatar-badge';
import { Keypad } from '../../ui/keypad';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import { AuthService, type SignInFailure, type SignInResult } from './auth';
import type { KnownAccount } from './session-store';

/** The steps of the entry screen (journal-gardien-entree.html, decisions of 2026-11-07). */
export type SignInStep = 'who' | 'phone' | 'code' | 'new-code' | 'confirm-code';

type Notice = { readonly tone: 'refused' | 'wait' | 'info'; readonly text: string };

// The entry of the notebook (G.2): who holds it — the accounts known to this phone, as big
// avatars —, then the code on a pad of big keys, opened at the last digit. The first sign-in
// takes the code the chef gave, then one's own code, typed twice. A refusal is shown by red
// rounds and a post-it; the voice comes with the clips (epic I).
@Component({
  selector: 'app-sign-in',
  imports: [AvatarBadge, Keypad, Pictogram, PostIt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="entry">
      <header class="cover">
        @if (step() === 'who') {
          <h1>Qui tient le cahier ?</h1>
        } @else {
          <app-avatar-badge class="small" [avatar]="account()?.avatar ?? null" />
          <h1>{{ step() === 'phone' ? 'Ton numéro' : account()?.name || phone() }}</h1>
          @if (accounts.length > 0) {
            <button type="button" class="back" (click)="restart()" aria-label="Changer de compte"><app-pictogram picto="caretaker" [decorative]="true" /></button>
          }
        }
      </header>

      <section class="page">
        @switch (step()) {
          @case ('who') {
            @for (known of accounts; track known.userId) {
              <button type="button" class="account" (click)="choose(known)">
                <app-avatar-badge [avatar]="known.avatar" />
                <span class="name">{{ known.name }}</span>
              </button>
            }
            <button type="button" class="other" (click)="step.set('phone')"><app-pictogram picto="caretaker" [decorative]="true" /> Un autre compte</button>
          }
          @case ('phone') {
            <form class="phone" (submit)="usePhone($event)">
              <label>
                Numéro de téléphone
                <input name="phone" type="tel" inputmode="tel" autocomplete="tel" [value]="phone()" (input)="phone.set(valueOf($event))" required />
              </label>
              <button type="submit" class="go">Continuer</button>
            </form>
          }
          @default {
            @if (step() !== 'code') {
              <ol class="steps">
                <li class="done"><app-pictogram picto="paper" [decorative]="true" /><span>Code du chef</span></li>
                <li [class.done]="step() === 'confirm-code'" [class.current]="step() === 'new-code'"><span class="number">1</span><span>Ton code</span></li>
                <li [class.current]="step() === 'confirm-code'"><span class="number">2</span><span>Encore</span></li>
              </ol>
            }
            <div class="rounds" [class.refused]="refused()" role="img" [attr.aria-label]="digits().length + ' chiffres tapés'">
              @for (slot of slots(); track $index) {
                <i [class.full]="$index < digits().length"></i>
              }
            </div>
            @if (notice(); as shown) {
              <app-post-it [class]="shown.tone">
                <p class="notice" role="alert">
                  <app-pictogram [picto]="shown.tone === 'wait' ? 'stamp-pending' : shown.tone === 'refused' ? 'cross' : 'round-check'" [decorative]="true" />
                  {{ shown.text }}
                </p>
              </app-post-it>
            }
            <app-keypad [withValidate]="expectedLength() === null" [disabled]="busy()" (digit)="press($event)" (erase)="erase()" (validate)="submit()" />
          }
        }
      </section>
    </main>
  `,
  styles: `
    :host { display: block; min-block-size: 100dvh; background: var(--color-shell); }
    .cover {
      display: flex; align-items: center; gap: 10px;
      padding: 14px;
      background: linear-gradient(180deg, var(--color-kraft), var(--color-kraft-dark));
      border-block-end: 3px dashed var(--color-card-edge);
    }
    h1 { flex: 1; margin: 0; font: 700 1.3rem var(--font-hand); color: var(--color-paper); }
    .small { --avatar-size: 54px; }
    .back { inline-size: var(--touch-target-min); block-size: var(--touch-target-min); border: 2px solid var(--color-ink); border-radius: var(--radius-blob); background: var(--color-paper); cursor: pointer; }
    .back:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .back app-pictogram { inline-size: 30px; block-size: 30px; }
    .page { display: flex; flex-direction: column; align-items: center; gap: 18px; padding: 18px 14px; background-image: var(--notebook-lines); }
    .account {
      inline-size: 230px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 14px;
      background: var(--color-paper); border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1);
      box-shadow: var(--shadow-hard); cursor: pointer;
    }
    .account:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .account:focus-visible, .other:focus-visible, .go:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .name { font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    .other {
      min-block-size: var(--touch-target-min); display: flex; align-items: center; gap: 8px; padding: 10px 16px;
      border: 2px dashed var(--color-card-edge); background: transparent; font: 700 1rem var(--font-hand); color: var(--color-earth); cursor: pointer;
    }
    .other app-pictogram { inline-size: 30px; block-size: 30px; }
    .phone { display: flex; flex-direction: column; gap: 14px; inline-size: 260px; }
    .phone label { display: flex; flex-direction: column; gap: 6px; font-weight: 700; }
    .phone input { min-block-size: var(--touch-target-min); padding: 8px 10px; font: 700 1.4rem var(--font-hand); border: 3px solid var(--color-ink); background: var(--color-paper); }
    .go { min-block-size: var(--touch-target-min); border: 3px solid var(--color-ink); background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand); box-shadow: var(--shadow-hard); cursor: pointer; }
    .steps { list-style: none; display: flex; gap: 10px; margin: 0; padding: 0; }
    .steps li { inline-size: 84px; display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; font: 700 0.85rem var(--font-hand); color: var(--color-neutral); }
    .steps app-pictogram { inline-size: 40px; block-size: 40px; }
    .number { inline-size: 40px; block-size: 40px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 3px solid var(--color-neutral); font-size: 1.2rem; }
    .steps .done { color: var(--color-pasture); }
    .steps .done .number { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .steps .current { color: var(--color-earth); }
    .steps .current .number { border-color: var(--color-corn); background: var(--color-straw); }
    .rounds { display: flex; gap: 18px; }
    .rounds i { inline-size: 34px; block-size: 34px; border-radius: var(--radius-blob); border: 3px dashed var(--color-card-edge); background: var(--color-slot); }
    .rounds i.full { border: 3px solid var(--color-pasture); background: var(--color-pasture); }
    .rounds.refused { animation: shake 0.3s; }
    .rounds.refused i { border: 3px solid var(--color-alert); background: var(--color-alert); }
    .notice { display: flex; align-items: center; gap: 10px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .notice app-pictogram { inline-size: 30px; block-size: 30px; flex: none; }
    @keyframes shake { 25% { transform: translateX(-6px); } 75% { transform: translateX(6px); } }
  `,
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly accounts = this.auth.knownAccounts();
  protected readonly step = signal<SignInStep>(this.accounts.length > 0 ? 'who' : 'phone');
  protected readonly account = signal<KnownAccount | null>(null);
  protected readonly phone = signal('+221');
  protected readonly digits = signal('');
  protected readonly refused = signal(false);
  protected readonly notice = signal<Notice | null>(null);
  protected readonly busy = signal(false);
  private provisionalPin = '';
  private newPin = '';

  /** How many digits the code has: 4 for a caretaker, 6 for an admin; unknown for a new account (it validates by hand). */
  protected readonly expectedLength = computed(() => {
    if (this.step() !== 'code') {
      return 4; // only a collaborator chooses a first code
    }
    const role = this.account()?.role;
    return role === undefined ? null : role === 'admin' ? 6 : 4;
  });
  protected readonly slots = computed(() => Array.from({ length: this.expectedLength() ?? Math.max(4, this.digits().length) }));

  protected valueOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected choose(known: KnownAccount): void {
    this.account.set(known);
    this.phone.set(known.phone);
    this.openCode('code');
  }

  protected usePhone(event: Event): void {
    event.preventDefault();
    this.account.set(this.accounts.find((known) => known.phone === this.phone()) ?? null);
    this.openCode('code');
  }

  protected restart(): void {
    this.account.set(null);
    this.step.set('who');
    this.notice.set(null);
  }

  protected press(digit: string): void {
    if (this.busy() || this.digits().length >= 6) {
      return;
    }
    this.refused.set(false);
    this.digits.update((typed) => typed + digit);
    if (this.digits().length === this.expectedLength()) {
      void this.submit();
    }
  }

  protected erase(): void {
    this.digits.update((typed) => typed.slice(0, -1));
  }

  protected async submit(): Promise<void> {
    const typed = this.digits();
    switch (this.step()) {
      case 'code':
        return this.signIn(typed);
      case 'new-code':
        this.newPin = typed;
        this.openCode('confirm-code');
        return;
      case 'confirm-code':
        if (typed !== this.newPin) {
          this.openCode('new-code', { tone: 'refused', text: 'Les deux codes ne sont pas pareils. Recommence.' });
          return;
        }
        return this.choosePin();
    }
  }

  private async signIn(pin: string): Promise<void> {
    const result = await this.run(() => this.auth.signIn(this.phone(), pin));
    if (!result.ok && result.refusal.kind === 'PinMustBeChosen') {
      this.provisionalPin = pin;
      this.openCode('new-code', { tone: 'info', text: 'Première fois : choisis ton propre code, et garde-le pour toi.' });
    }
  }

  private async choosePin(): Promise<void> {
    const result = await this.run(() => this.auth.choosePin(this.phone(), this.provisionalPin, this.newPin));
    if (!result.ok && result.refusal.kind !== 'InvalidCredentials' && result.refusal.kind !== 'TooManyAttempts') {
      this.step.set('new-code');
    }
  }

  private async run(attempt: () => Promise<SignInResult>): Promise<SignInResult> {
    this.busy.set(true);
    const result = await attempt();
    this.busy.set(false);
    if (result.ok) {
      await this.router.navigateByUrl(result.home);
      return result;
    }
    this.digits.set('');
    this.refused.set(result.refusal.kind === 'InvalidCredentials');
    this.notice.set(noticeOf(result.refusal));
    return result;
  }

  private openCode(step: SignInStep, notice: Notice | null = null): void {
    this.step.set(step);
    this.digits.set('');
    this.refused.set(false);
    this.notice.set(notice);
  }
}

function noticeOf(refusal: SignInFailure): Notice {
  const refused = (text: string): Notice => ({ tone: 'refused', text });
  switch (refusal.kind) {
    case 'InvalidCredentials':
      return refused("Ce n'est pas le bon code. Essaie encore.");
    case 'TooManyAttempts':
      return { tone: 'wait', text: `Trop d'essais. Réessaie à ${new Date(refusal.retryAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.` };
    case 'AccountBlocked':
      return refused('Ce compte est bloqué. Parle au chef.');
    case 'PinMustBeChosen':
      return { tone: 'info', text: 'Première fois : choisis ton propre code, et garde-le pour toi.' };
    case 'ProvisionalPinExpired':
      return refused("Le code du chef n'est plus bon. Demande-lui un nouveau code.");
    case 'PinAlreadyChosen':
      return refused('Ton code est déjà choisi : tape-le pour entrer.');
    case 'InvalidPin':
    case 'TrivialPin':
    case 'SameAsProvisionalPin':
      return refused('Ce code est trop simple, ou pareil à celui du chef. Choisis-en un autre.');
    case 'InvalidRequest':
      return refused('Le numéro s’écrit en entier, par exemple +221771234567.');
    case 'Offline':
      return { tone: 'wait', text: 'Pas de réseau. Réessaie quand le téléphone a du réseau.' };
    case 'ServerUnavailable':
      return { tone: 'wait', text: 'Le service ne répond pas. Réessaie plus tard.' };
  }
}
