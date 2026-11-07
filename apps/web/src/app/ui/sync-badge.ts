import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Pictogram } from './pictogram';

// The sync badge on the cover of the notebook (H.5, mockup .nuage .badge): how many events wait
// to leave, or « bien envoyé » when nothing waits. Never the colour alone: a number or a check
// mark, and the words for a screen reader. It pops by transform, never by box-shadow.
@Component({
  selector: 'app-sync-badge',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cloud" role="status" [attr.aria-label]="words()">
      <app-pictogram picto="sync-cloud" [decorative]="true" />
      <span class="badge" [class.sent]="waiting() === 0" aria-hidden="true">{{ waiting() === 0 ? '✓' : waiting() }}</span>
    </span>
  `,
  styles: `
    :host { display: inline-block; }
    .cloud { position: relative; display: block; inline-size: 58px; block-size: 48px; }
    app-pictogram { inline-size: 100%; block-size: 100%; }
    .badge {
      position: absolute; inset-block-start: -4px; inset-inline-end: -6px;
      min-inline-size: 25px; block-size: 25px; padding: 0 6px;
      display: flex; align-items: center; justify-content: center;
      border-radius: 50% 45% 50% 48%;
      border: 2px solid var(--color-kraft);
      background: var(--color-orange);
      color: var(--color-on-sign);
      font: 700 0.85rem var(--font-hand);
      animation: pop 0.18s ease;
    }
    .badge.sent { background: var(--color-pasture); }
    @keyframes pop { from { transform: scale(1.3) rotate(-8deg); } to { transform: scale(1) rotate(0); } }
  `,
})
export class SyncBadge {
  /** Events waiting in the outbox (JournalSync.waiting, G.4). */
  readonly waiting = input.required<number>();
  protected readonly words = computed(() => {
    const n = this.waiting();
    return n === 0 ? 'Tout est bien envoyé' : `${n} ${n === 1 ? 'déclaration attend' : 'déclarations attendent'} le réseau`;
  });
}
