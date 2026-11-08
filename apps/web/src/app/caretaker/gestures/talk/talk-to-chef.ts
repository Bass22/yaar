import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import type { CaretakerChef } from '@contracts';
import { clip } from '../../../core/audio/phrase';
import { Voice } from '../../../core/audio/voice';
import { GestureButton } from '../../../ui/gesture-button';
import { Pictogram } from '../../../ui/pictogram';
import { PostIt } from '../../../ui/post-it';

/** WhatsApp's link to a conversation: the number in international form, digits only. */
export const whatsAppLinkOf = (phone: string): string => `https://wa.me/${phone.replace(/\D/g, '')}`;

// « Parler » (M.5, CdC « Parler au chef passe par WhatsApp », decision of 2026-11-08): the
// conversation with the chef opens in WhatsApp, where the caretaker leaves a voice note as usual.
// No pre-filled text: it would stay a draft. Without a chef to reach, the post-it and the voice say so.
@Component({
  selector: 'app-talk-to-chef',
  imports: [GestureButton, Pictogram, PostIt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-gesture-button picto="microphone-white" label="Parler" tone="voice" (click)="talk()" />
    @if (noChef()) {
      <app-post-it class="no-chef">
        <p role="alert"><app-pictogram picto="question" [decorative]="true" /> Le numéro du chef n’est pas encore dans le cahier. Appelle-le directement.</p>
      </app-post-it>
    }
  `,
  styles: `
    :host { display: block; }
    .no-chef { display: block; margin-block-start: 10px; }
    .no-chef p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .no-chef app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
  `,
})
export class TalkToChef {
  private readonly voice = inject(Voice);

  /** Whom to reach, from the context; `null` when the farm has no admin to reach. */
  readonly chef = input.required<CaretakerChef | null>();

  protected readonly noChef = signal(false);

  protected talk(): void {
    const chef = this.chef();
    if (chef === null) {
      this.noChef.set(true);
      void this.voice.say([clip('talk-no-chef')]);
      return;
    }
    this.noChef.set(false);
    // Outside the application: WhatsApp takes the link and opens the conversation.
    globalThis.open(whatsAppLinkOf(chef.phone), '_blank', 'noopener');
  }
}
