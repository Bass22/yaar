import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { PictogramName } from '@design-system';
import { Pictogram } from '../../ui/pictogram';

// A tab of the office whose screens come later (Achats with Q, Tiers with R): its place is kept,
// and it says so, rather than showing an empty page.
@Component({
  selector: 'app-coming-soon',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram [picto]="tab.picto" [decorative]="true" /> {{ tab.title }}</h1>
    <p class="soon">{{ tab.words }}</p>
  `,
  styles: `
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 32px; block-size: 32px; }
    .soon { margin: 0; color: var(--color-muted); font-style: italic; }
  `,
})
export class ComingSoon {
  /** What the route says of the tab. */
  protected readonly tab = inject(ActivatedRoute).snapshot.data as { readonly title: string; readonly picto: PictogramName; readonly words: string };
}
