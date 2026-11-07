import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { AccountAvatar } from '@contracts';
import { AvatarBadge } from '../../ui/avatar-badge';
import { Pictogram } from '../../ui/pictogram';
import { SyncBadge } from '../../ui/sync-badge';

/** « Cahier d'Ousmane », « Cahier de Modou »: the name written on the cover, elided before a vowel. */
export const notebookTitle = (name: string): string => (/^[aeiouyàâäéèêëîïôöùûü]/i.test(name) ? `Cahier d'${name}` : `Cahier de ${name}`);

// The kraft cover of the notebook (J.1, journal-gardien.html .app-head): whose notebook — avatar
// and name —, which site, the primary caretaker's badge, and how many declarations wait to leave.
@Component({
  selector: 'app-notebook-cover',
  imports: [AvatarBadge, Pictogram, SyncBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="cover">
      <app-avatar-badge class="avatar" [avatar]="avatar()" />
      <div class="sticker">
        <p class="name">{{ title() }}</p>
        @if (siteName(); as site) {
          <p class="site"><app-pictogram picto="barn" [decorative]="true" /> {{ site }}</p>
        }
        @if (primary()) {
          <p class="primary" role="img" aria-label="Tu es le titulaire du site"><app-pictogram picto="caretaker" [decorative]="true" /> Titulaire</p>
        }
      </div>
      <app-sync-badge [waiting]="waiting()" />
    </header>
  `,
  styles: `
    :host { display: block; }
    .cover {
      display: flex; align-items: center; gap: 12px; padding: 14px 14px 12px;
      background: linear-gradient(180deg, var(--color-kraft), var(--color-kraft-dark));
      border-block-end: 3px dashed var(--color-card-edge);
    }
    .avatar { --avatar-size: 54px; flex: none; }
    .sticker {
      flex: 1; min-inline-size: 0; position: relative; padding: 6px 12px;
      background: var(--color-paper); border: 2px solid var(--color-card-edge); box-shadow: var(--shadow-hard-sm);
      transform: rotate(-1.1deg);
    }
    .sticker::before {
      content: ''; position: absolute; inset-block-start: -9px; inset-inline-start: 18px; inline-size: 54px; block-size: 14px;
      background: var(--color-tape); border: 1px solid var(--color-tape-edge); transform: rotate(-3deg);
    }
    p { margin: 0; }
    .name { font: 700 1.1rem var(--font-hand); color: var(--color-earth); line-height: 1.1; overflow-wrap: anywhere; }
    .site, .primary { display: flex; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--color-muted); }
    .site app-pictogram, .primary app-pictogram { inline-size: 18px; block-size: 18px; flex: none; }
    .primary { margin-block-start: 2px; inline-size: fit-content; padding: 0 6px; background: var(--color-straw); border: 1px solid var(--color-corn); color: var(--color-earth); font-weight: 700; }
    app-sync-badge { flex: none; }
  `,
})
export class NotebookCover {
  readonly name = input.required<string>();
  protected readonly title = computed(() => notebookTitle(this.name()));
  readonly avatar = input<AccountAvatar | null>(null);
  readonly siteName = input<string | null>(null);
  readonly primary = input(false);
  readonly waiting = input(0);
}
