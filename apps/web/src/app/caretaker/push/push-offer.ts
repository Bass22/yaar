import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { clip } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { PushNotifications } from '../../core/push/push-notifications';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import { SpeakerButton } from '../../ui/speaker-button';

// The offer of notifications in the notebook (Y.1; CdC « Notifications push »): until the assisted
// onboarding (Z.7), the agreement is given here. A bell, the voice, Oui or Plus tard; the
// browser then asks in its turn. A refusal or « Plus tard » puts it away for good.
@Component({
  selector: 'app-push-offer',
  imports: [Pictogram, PostIt, SpeakerButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (push.state() === 'ask') {
      <app-post-it class="offer">
        <p class="line"><app-pictogram picto="bell" [decorative]="true" /> <span class="words">Le chef peut te prévenir sur ce téléphone : une livraison, une pesée, le rappel du soir.</span> <app-speaker-button phrase="push-ask" /></p>
        <div class="actions">
          <button type="button" class="later" (click)="push.later()">Plus tard</button>
          <button type="button" class="yes" (click)="agree()"><app-pictogram picto="check" [decorative]="true" /> Oui</button>
        </div>
      </app-post-it>
    }
  `,
  styles: `
    :host { display: block; }
    .offer { display: block; margin-block-start: 12px; }
    .line { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .line app-pictogram { inline-size: 34px; block-size: 34px; flex: none; }
    .words { flex: 1; }
    .actions { display: flex; gap: 8px; }
    .actions button {
      min-block-size: 56px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 8px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      color: var(--color-on-sign); font: 700 1rem var(--font-hand); cursor: pointer;
    }
    .actions button:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .actions button:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .actions app-pictogram { inline-size: 24px; block-size: 24px; }
    .later { flex: 1; background: var(--color-neutral); }
    .yes { flex: 2; background: var(--color-pasture); }
  `,
})
export class PushOffer {
  protected readonly push = inject(PushNotifications);
  private readonly voice = inject(Voice);

  constructor() {
    void this.push.refresh();
  }

  protected async agree(): Promise<void> {
    if (await this.push.agree()) void this.voice.say([clip('push-on')]);
  }
}
