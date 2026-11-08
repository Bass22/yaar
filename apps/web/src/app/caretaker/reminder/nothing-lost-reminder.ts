import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { clip } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { JournalSync } from '../../core/sync/journal-sync';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import { SpeakerButton } from '../../ui/speaker-button';
import { Stamp } from '../../ui/stamp';
import type { DeclarationTarget } from '../notebook/notebook';

const STAMP_MS = 1500;

// The reminder of yesterday (K.4, mockup journal-gardien.html .nudge): while yesterday's deaths
// are not written, a post-it offers the zero in one tap — « Rien perdu hier » — or the notebook
// opened on yesterday. Zero is a declaration, never an absence (CLAUDE.md §4 rule 10). The stamp
// stays outside the post-it: the post-it goes as soon as the zero is kept.
@Component({
  selector: 'app-nothing-lost-reminder',
  imports: [Pictogram, PostIt, SpeakerButton, Stamp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (yesterday()) {
      <app-post-it class="nudge">
        <p class="line"><app-pictogram picto="question" [decorative]="true" /> <span class="words">Pour hier, les morts ne sont pas écrits.</span> <app-speaker-button phrase="nothing-lost-reminder" /></p>
        <div class="actions">
          <button type="button" class="zero" [disabled]="saving()" (click)="writeZero()"><app-pictogram picto="check" [decorative]="true" /> Rien perdu hier</button>
          <button type="button" class="go" (click)="writeForYesterday.emit()"><app-pictogram picto="pencil" [decorative]="true" /> Écrire pour hier</button>
        </div>
      </app-post-it>
    }
    @if (failed()) {
      <app-post-it class="failed">
        <p role="alert"><app-pictogram picto="cross" [decorative]="true" /> Le téléphone n’arrive plus à garder tes déclarations. Appelle le chef.</p>
      </app-post-it>
    }
    <div class="layer"><app-stamp [shown]="stamped()" word="C’est noté !" /></div>
  `,
  styles: `
    :host { display: block; }
    .nudge, .failed { display: block; margin-block-start: 12px; }
    .line { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .line app-pictogram { inline-size: 34px; block-size: 34px; flex: none; }
    .words { flex: 1; }
    .actions { display: flex; gap: 8px; }
    .actions button {
      flex: 1; min-block-size: 56px; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 10px 8px;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      color: var(--color-on-sign); font: 700 1rem var(--font-hand); cursor: pointer;
    }
    .actions button:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .actions button:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .actions button:disabled { opacity: 0.6; cursor: wait; }
    .actions app-pictogram { inline-size: 24px; block-size: 24px; }
    .zero { background: var(--color-pasture); }
    .go { background: var(--color-orange); }
    .failed p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .failed app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
  `,
})
export class NothingLostReminder {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);

  /** Yesterday, when its deaths are not written; `null` hides the post-it. */
  readonly yesterday = input.required<DeclarationTarget | null>();
  /** « Écrire pour hier »: the notebook opens on yesterday. */
  readonly writeForYesterday = output();

  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  protected readonly failed = signal(false);

  protected async writeZero(): Promise<void> {
    const target = this.yesterday();
    if (this.saving() || target === null) {
      return;
    }
    this.saving.set(true);
    this.failed.set(false);
    try {
      await this.sync.record({ ...target, recordedAt: this.clock.now().toISOString(), fact: { type: 'NoLoss' } });
      this.stamped.set(true);
      void this.voice.say([clip('nothing-lost-done')]);
      setTimeout(() => this.stamped.set(false), STAMP_MS);
    } catch {
      this.failed.set(true);
      void this.voice.say([clip('storage-full')]);
    } finally {
      this.saving.set(false);
    }
  }
}
