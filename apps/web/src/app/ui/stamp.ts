import { ChangeDetectionStrategy, Component, input } from '@angular/core';

// The stamp « C'est noté » (H.5, mockup .bravo): it slams down on the page once a declaration
// is kept, then the screen takes it away. Shown only once the outbox has kept the event (G.3).
// It moves by transform and opacity only.
@Component({
  selector: 'app-stamp',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cover" [class.on]="shown()" role="status" aria-live="polite">
      @if (shown()) {
        <div class="stamp">
          <svg viewBox="0 0 160 160" aria-hidden="true" focusable="false">
            <g fill="none" stroke="currentColor">
              <circle cx="80" cy="80" r="70" stroke-width="7" />
              <circle cx="80" cy="80" r="58" stroke-width="2.5" stroke-dasharray="4 4" />
              <path d="M52 84 l20 20 l38 -44" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" />
            </g>
          </svg>
          <p class="word">{{ word() }}</p>
        </div>
      }
    </div>
  `,
  styles: `
    :host { position: absolute; inset: 0; pointer-events: none; z-index: 9; }
    .cover { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s; }
    .cover.on { opacity: 1; background: var(--color-shell); }
    .stamp { color: var(--color-pasture); text-align: center; transform: rotate(-10deg); animation: slam 0.4s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
    svg { inline-size: 190px; block-size: 190px; display: block; }
    /* Across the bottom of the ring, as in the mockup, on a band of paper so that the ring does not cross the letters. */
    .word { position: relative; display: inline-block; margin: -34px 0 0; padding: 0 8px; background: var(--color-shell); font: 700 1.4rem var(--font-hand); }
    @keyframes slam {
      from { transform: scale(2.1) rotate(6deg); opacity: 0; }
      60% { transform: scale(0.92) rotate(-11deg); opacity: 1; }
      to { transform: scale(1) rotate(-10deg); opacity: 1; }
    }
  `,
})
export class Stamp {
  readonly shown = input(false);
  readonly word = input("C'est noté !");
}
