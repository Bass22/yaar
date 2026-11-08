import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { BusinessDay } from '@domain/journal';
import type { ScriptClip } from '../../core/audio/script-clips';
import type { OutboxEntry } from '../../core/outbox/outbox';
import { JournalSync } from '../../core/sync/journal-sync';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import { SpeakerButton } from '../../ui/speaker-button';
import { lineOf } from '../notebook/day-journal';
import { shortDate } from '../notebook/day-tabs';

type RefusedItem = { readonly id: string; readonly picto: ReturnType<typeof lineOf>['picto']; readonly words: string; readonly day: string; readonly phrase: ScriptClip };

/** Why, said in the voice: the chef has it and takes care of it, except a « rien perdu » that deaths contradict. */
function phraseOf(kind: string | undefined): ScriptClip {
  return kind === 'CatchUpWindowPassed' ? 'sync-refused-too-old' : kind === 'NoLossAfterDeaths' ? 'nothing-lost-refused' : 'sync-refused';
}

function itemOf(entry: OutboxEntry): RefusedItem | null {
  const { payload } = entry;
  if (!('fact' in payload)) {
    return null;
  }
  const { picto, words } = lineOf(payload.fact);
  return { id: entry.id, picto, words, day: shortDate(payload.businessDate as BusinessDay), phrase: phraseOf(entry.refusal?.kind) };
}

// What the server did not take (G.5, CdC « Une déclaration refusée n'est jamais perdue »): each
// refused declaration on a post-it — picto, quantity, day — and the voice says why, until the
// caretaker touches « J'ai compris ». The server keeps them for the chef. A session cut off says
// so too: nothing is lost, the declarations wait on the phone.
@Component({
  selector: 'app-refusal-notice',
  imports: [Pictogram, PostIt, SpeakerButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length > 0) {
      <app-post-it class="refused">
        <p class="head" role="alert"><app-pictogram picto="cross" [decorative]="true" /> Le chef n’a pas pu accepter :</p>
        <ul>
          @for (item of items(); track item.id) {
            <li class="item">
              <app-pictogram class="what" [picto]="item.picto" [decorative]="true" />
              <span class="words"><b>{{ item.words }}</b> · {{ item.day }}</span>
              <app-speaker-button [phrase]="item.phrase" />
            </li>
          }
        </ul>
        <button type="button" class="understood" (click)="understood()"><app-pictogram picto="check" [decorative]="true" /> J’ai compris</button>
      </app-post-it>
    }
    @switch (sync.stopped()) {
      @case ('SessionRevoked') {
        <app-post-it class="session">
          <p role="alert"><app-pictogram picto="cross" [decorative]="true" /> <span class="words">Ton compte ne peut plus envoyer. Parle au chef. Rien n’est perdu.</span> <app-speaker-button phrase="sync-stopped" /></p>
        </app-post-it>
      }
      @case ('SessionExpired') {
        <app-post-it class="session">
          <p role="alert"><app-pictogram picto="stamp-pending" [decorative]="true" /> <span class="words">Reconnecte-toi pour envoyer tes déclarations. Rien n’est perdu.</span> <app-speaker-button phrase="sync-sign-in-again" /></p>
          <a class="again" href="/sign-in"><app-pictogram picto="check" [decorative]="true" /> Entrer mon code</a>
        </app-post-it>
      }
    }
  `,
  styles: `
    :host { display: block; }
    app-post-it { display: block; margin-block-start: 12px; }
    p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    p app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .words { flex: 1; }
    ul { list-style: none; margin: 8px 0; padding: 0; }
    .item { display: flex; align-items: center; gap: 10px; min-block-size: 52px; border-block-end: 1px dashed var(--color-card-edge); color: var(--color-earth); }
    .what { inline-size: 40px; block-size: 36px; flex: none; }
    .understood, .again {
      display: flex; align-items: center; justify-content: center; gap: 8px; inline-size: 100%; min-block-size: 56px; margin-block-start: 8px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.05rem var(--font-hand); text-decoration: none; cursor: pointer;
    }
    .understood:active, .again:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .understood:focus-visible, .again:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .understood app-pictogram, .again app-pictogram { inline-size: 24px; block-size: 24px; }
  `,
})
export class RefusalNotice {
  protected readonly sync = inject(JournalSync);

  /** The refusals not yet heard, oldest first. */
  protected readonly items = computed(() =>
    this.sync
      .refused()
      .filter((entry) => entry.refusalSeen !== true)
      .map(itemOf)
      .filter((item): item is RefusedItem => item !== null),
  );

  protected understood(): void {
    void this.sync.acknowledgeRefusals(this.items().map((item) => item.id));
  }
}
