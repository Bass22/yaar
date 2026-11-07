import { ChangeDetectionStrategy, Component } from '@angular/core';

// The post-it of the notebook (H.3, mockup .nudge): a reminder stuck on the page — yesterday
// is empty, a task waits.
@Component({
  selector: 'app-post-it',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<aside class="post-it"><ng-content /></aside>`,
  styles: `
    :host { display: block; }
    .post-it {
      position: relative;
      padding: 12px;
      background: var(--color-post-it);
      border: 1px solid var(--color-tape-edge);
      box-shadow: var(--shadow-hard-sm);
      transform: rotate(-0.8deg);
    }
    .post-it::before {
      content: '';
      position: absolute; inset-block-start: -10px; inset-inline-start: 50%;
      inline-size: 70px; block-size: 16px;
      background: var(--color-tape);
      border: 1px solid var(--color-tape-edge);
      transform: translateX(-50%) rotate(2deg);
    }
  `,
})
export class PostIt {}
