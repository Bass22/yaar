import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { AVATARS, PICTOGRAM_LABELS, type PictogramName } from '@design-system';
import type { AccountAvatar } from '@contracts';
import { Pictogram } from './pictogram';

// The avatar of an account (E.9, journal-gardien-entree.html): its drawing on its own colour,
// in a slightly tilted round. It says the avatar's name; an account without avatar shows the
// caretaker pictogram.
@Component({
  selector: 'app-avatar-badge',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [style.background]="background()" role="img" [attr.aria-label]="label()">
      <app-pictogram [picto]="picto()" [decorative]="true" />
    </span>
  `,
  styles: `
    :host { display: inline-block; inline-size: var(--avatar-size, 112px); block-size: var(--avatar-size, 112px); }
    .badge {
      inline-size: 100%; block-size: 100%;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50%;
      border: 3px solid var(--color-ink);
      background: var(--color-straw);
      transform: rotate(-2deg);
    }
    app-pictogram { inline-size: 72%; block-size: 72%; }
  `,
})
export class AvatarBadge {
  readonly avatar = input<AccountAvatar | null>(null);

  protected readonly picto = computed((): PictogramName => (this.avatar() === null ? 'caretaker' : `avatar-${this.avatar()}` as PictogramName));
  protected readonly background = computed(() => AVATARS.find((avatar) => avatar.name === this.picto())?.background ?? null);
  protected readonly label = computed(() => PICTOGRAM_LABELS[this.picto()]);
}
