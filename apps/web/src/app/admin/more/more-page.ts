import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Pictogram } from '../../ui/pictogram';

// « Plus »: the settings of the farm (bureau-admin-v2.html). Sites and team come with O.1;
// reference data and the price catalogue with N.
@Component({
  selector: 'app-more-page',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Réglages</h1>
    <ul class="settings">
      <li><app-pictogram picto="barn" [decorative]="true" /> Sites et équipe</li>
    </ul>
  `,
  styles: `
    h1 { margin: 0 0 8px; font: 700 1.3rem var(--font-hand); color: var(--color-earth); }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: flex; align-items: center; gap: 10px; min-block-size: 56px; border-block-end: 1px dashed var(--color-card-edge); font-weight: 700; }
    li app-pictogram { inline-size: 32px; block-size: 32px; }
  `,
})
export class MorePage {}
