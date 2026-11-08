import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { PictogramName } from '@design-system';
import type { FactPayload } from '@contracts';
import { Pictogram } from '../../ui/pictogram';
import type { NotebookLine } from './notebook-view';

export type NamedLine = NotebookLine & { readonly authorName: string };

/** The picto and the words of a fact, as written in the notebook. */
export function lineOf(fact: FactPayload): { readonly picto: PictogramName; readonly words: string } {
  const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;
  switch (fact.type) {
    case 'Death':
      return { picto: 'dead-chicken', words: plural(fact.quantity, 'mort', 'morts') };
    case 'BagOpened':
      return { picto: 'open-bag', words: plural(fact.quantity, 'sac ouvert', 'sacs ouverts') };
    case 'NoLoss':
      return { picto: 'round-check', words: 'Rien perdu' };
    case 'Loss':
      return { picto: 'question', words: plural(fact.quantity, 'perdu', 'perdus') };
    case 'Delivery':
      return { picto: 'received-bags', words: plural(fact.receivedQuantity, 'reçu', 'reçus') };
    case 'Weighing':
      return { picto: 'scale', words: plural(fact.weights.length, 'poulet pesé', 'poulets pesés') };
    case 'TaskDone':
      return { picto: 'round-check', words: 'Tâche faite' };
    case 'VoiceMessage':
      return { picto: 'microphone', words: 'Message vocal' };
    case 'Photo':
      return { picto: 'camera', words: 'Photo' };
  }
}

// The journal of the chosen day (J.3, journal-gardien.html .evt): visible before any gesture,
// the latest written on top; each line with its picto, its quantity and its author. A line
// still on the phone wears the clock, a line the server has wears the stamp « bien envoyé ».
@Component({
  selector: 'app-day-journal',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title"><app-pictogram picto="pencil" [decorative]="true" /> {{ title() }}, dans le cahier</h2>
    @if (lines().length === 0) {
      <p class="empty"><app-pictogram picto="paper" [decorative]="true" /> Rien d'écrit pour l'instant</p>
    } @else {
      <ul class="lines">
        @for (line of lines(); track line.id) {
          <li class="line" [class.retracted]="line.retracted">
            <app-pictogram class="what" [picto]="pictoOf(line)" [decorative]="true" />
            <span class="words">
              <b>{{ wordsOf(line) }}</b>
              <small>{{ line.authorName }}{{ line.corrected ? ' · corrigé' : '' }}{{ line.retracted ? ' · annulé par le chef' : line.waiting ? " · en attente d'envoi" : ' · bien envoyé' }}</small>
            </span>
            @if (line.pencil !== null) {
              <button type="button" class="pencil" [class.locked]="line.pencil === 'locked'" [class.unavailable]="line.pencil === 'correct' && !online()" [attr.aria-label]="pencilLabel(line)" (click)="correct.emit(line)">
                <app-pictogram [picto]="line.pencil === 'correct' && !online() ? 'sync-cloud' : 'pencil'" [decorative]="true" />
              </button>
            }
            @if (!line.retracted) {
              <app-pictogram class="state" [picto]="line.waiting ? 'stamp-pending' : 'stamp-done'" />
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    :host { display: block; margin-block-start: 14px; }
    .title { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; font: 700 1.08rem var(--font-hand); color: var(--color-earth); }
    .title app-pictogram { inline-size: 25px; block-size: 25px; }
    .empty { display: flex; align-items: center; gap: 10px; margin: 0; padding: 12px 0; color: var(--color-muted); font-style: italic; }
    .empty app-pictogram { inline-size: 32px; block-size: 32px; opacity: 0.6; }
    .lines { list-style: none; margin: 0; padding: 0; }
    .line { display: flex; align-items: center; gap: 10px; min-block-size: 56px; padding: 6px 2px 6px 0; border-block-end: 1px dashed var(--color-card-edge); }
    .what { inline-size: 40px; block-size: 36px; flex: none; }
    .words { flex: 1; min-inline-size: 0; font-weight: 700; }
    .words b { display: block; font-size: 1rem; }
    .words small { display: block; font-size: 0.78rem; font-weight: 400; color: var(--color-muted); }
    .state { inline-size: 40px; block-size: 40px; flex: none; }
    .pencil {
      inline-size: var(--touch-target-min); block-size: var(--touch-target-min); flex: none;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      border: 2px solid var(--color-earth); border-radius: var(--radius-blob); background: var(--color-paper); box-shadow: var(--shadow-hard-sm);
    }
    .pencil:active { transform: translate(1px, 1px); }
    .pencil:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .pencil app-pictogram { inline-size: 24px; block-size: 24px; }
    /* It cannot act now: dashed and flat, but as dark as the others — read in the sun. */
    .pencil.locked, .pencil.unavailable { border-style: dashed; border-width: 3px; background: var(--color-shell); box-shadow: none; }
    .retracted .words b { text-decoration: line-through; }
    .retracted .what { opacity: 0.45; }
  `,
})
export class DayJournal {
  readonly title = input.required<string>();
  readonly lines = input.required<readonly NamedLine[]>();
  /** Without it, the pencil of a sent line shows the cloud: correcting it needs the network (K.5). */
  readonly online = input(true);
  /** The pencil of a line was touched; the correction says what it can do. */
  readonly correct = output<NamedLine>();

  protected pencilLabel(line: NamedLine): string {
    return line.pencil === 'locked' ? 'Corriger : la ligne part en ce moment' : line.pencil === 'correct' && !this.online() ? 'Corriger : il faut du réseau' : 'Corriger';
  }

  protected pictoOf(line: NamedLine): PictogramName {
    return lineOf(line.fact).picto;
  }

  protected wordsOf(line: NamedLine): string {
    return lineOf(line.fact).words;
  }
}
