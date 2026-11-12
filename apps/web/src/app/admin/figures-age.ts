import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Pictogram } from '../ui/pictogram';

const time = (at: Date) => `${at.getHours()} h ${String(at.getMinutes()).padStart(2, '0')}`;
const day = (at: Date) => `${String(at.getDate()).padStart(2, '0')}/${String(at.getMonth() + 1).padStart(2, '0')}`;

// When the figures of an office screen were read (P.7): every screen says it. Without network, the
// last reading stays, and says its day and time.
@Component({
  selector: 'app-figures-age',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (words(); as words) {
      <p class="age" [class.stale]="stale()" role="status">
        @if (stale()) {
          <app-pictogram picto="sync-cloud" [decorative]="true" />
        }
        {{ words }}
      </p>
    }
  `,
  styles: `
    :host { display: block; }
    .age { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; font-size: 0.85rem; color: var(--color-muted); }
    .age.stale { padding: 6px 10px; border-inline-start: 4px solid var(--color-orange); background: var(--color-orange-light); color: var(--color-earth); font-weight: 700; }
    .age app-pictogram { inline-size: 20px; block-size: 20px; flex: none; }
  `,
})
export class FiguresAge {
  /** When the figures shown were read; `null` while nothing was. */
  readonly readAt = input.required<string | null>();
  /** The last reading did not come: the figures shown are older. */
  readonly stale = input(false);

  protected readonly words = computed(() => {
    const readAt = this.readAt();
    if (readAt === null) return this.stale() ? 'Pas de réseau : rien n’a encore été lu.' : null;
    const at = new Date(readAt);
    return this.stale() ? `Pas de réseau : chiffres du ${day(at)} à ${time(at)}` : `Chiffres de ${time(at)}`;
  });
}
