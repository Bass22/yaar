import { ChangeDetectionStrategy, Component, inject, input, signal, viewChild } from '@angular/core';
import type { PictogramName } from '@design-system';
import { clip } from '../../../core/audio/phrase';
import type { ScriptClip } from '../../../core/audio/script-clips';
import { Voice } from '../../../core/audio/voice';
import { CLOCK } from '../../../core/clock';
import { JournalSync } from '../../../core/sync/journal-sync';
import { Pictogram } from '../../../ui/pictogram';
import { PostIt } from '../../../ui/post-it';
import { BAGS } from '../../gestures/bag/bags';
import { CountSheets } from '../../gestures/count-sheets';
import { DEATHS } from '../../gestures/death/deaths';
import type { Gesture } from '../../gestures/gesture';
import type { NamedLine } from '../../notebook/day-journal';
import { Notebook, type DeclarationTarget } from '../../notebook/notebook';
import type { NotebookDay } from '../../notebook/notebook-view';

const STAMP_MS = 1500;
/** Long enough to read twice; the voice has said it already. */
const NOTICE_MS = 8000;

type Notice = { readonly picto: PictogramName; readonly words: string; readonly clip: ScriptClip };

const NOTICES = {
  locked: { picto: 'stamp-pending', words: 'Cette ligne part en ce moment. Attends un peu, puis corrige.', clip: 'correct-wait-sending' },
  needsNetwork: { picto: 'sync-cloud', words: 'Pour corriger, il faut du réseau. Réessaie quand le téléphone en a.', clip: 'correct-needs-network' },
  tooOld: { picto: 'moon', words: 'Ce jour est trop ancien pour corriger. Parle au chef.', clip: 'correct-too-old' },
  refused: { picto: 'cross', words: 'Le chef n’a pas pu accepter cette correction. Parle au chef.', clip: 'correct-refused' },
  storageFull: { picto: 'cross', words: 'Le téléphone n’arrive plus à garder tes déclarations. Appelle le chef.', clip: 'storage-full' },
} as const satisfies Record<string, Notice>;

// Correcting a line (K.5, CdC « Corrections »): the pencil opens the same count sheets as the
// gesture, started at the value that counts. While the declaration never left the phone, the
// outbox keeps the new value under the same identifier; once sent, a counter-declaration leaves
// at once — online only, never queued (decision of 2026-11-06). Nothing is ever erased: the
// counter does not go below one, and no gesture takes a line back.
@Component({
  selector: 'app-line-correction',
  imports: [CountSheets, Pictogram, PostIt],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (notice(); as shown) {
      <app-post-it class="notice-card">
        <p class="notice" role="alert"><app-pictogram [picto]="shown.picto" [decorative]="true" /> {{ shown.words }}</p>
      </app-post-it>
    }
    <app-count-sheets [gesture]="gesture()" [when]="when()" title="Corrige le nombre" stampWord="Corrigé !" [saving]="saving()" [stamped]="stamped()" (confirmed)="write($event)" />
  `,
  styles: `
    :host { display: block; }
    /* Fixed at the bottom of the screen: the pencil may be far down the journal, the notice is seen anyway. */
    .notice-card { position: fixed; inset-inline: 12px; inset-block-end: 12px; z-index: 4; display: block; }
    .notice { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .notice app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
  `,
})
export class LineCorrection {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly notebook = inject(Notebook);
  private readonly sheets = viewChild.required(CountSheets);

  /** The site, the campaign and the day of the lines shown. */
  readonly target = input.required<DeclarationTarget>();
  readonly when = input.required<NotebookDay['when']>();
  readonly online = input(true);

  protected readonly gesture = signal<Gesture>(DEATHS);
  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  protected readonly notice = signal<Notice | null>(null);
  private line: NamedLine | null = null;
  private noticeTimer: ReturnType<typeof setTimeout> | undefined;
  private openedOn: DeclarationTarget | null = null;

  /** The pencil of a line was touched. */
  start(line: NamedLine): void {
    this.notice.set(null);
    if (line.pencil === null || !('quantity' in line.fact)) {
      return;
    }
    if (line.pencil === 'locked') {
      this.tell(NOTICES.locked);
      return;
    }
    if (line.pencil === 'correct' && !this.online()) {
      this.tell(NOTICES.needsNetwork);
      return;
    }
    this.line = line;
    this.openedOn = this.target();
    this.gesture.set(line.fact.type === 'BagOpened' ? BAGS : DEATHS);
    this.sheets().open(line.fact.quantity, 'correct-how-many');
  }

  protected async write(quantity: number): Promise<void> {
    const line = this.line;
    const target = this.openedOn;
    if (this.saving() || line === null || target === null) {
      return;
    }
    this.saving.set(true);
    try {
      const notice = line.pencil === 'edit' ? await this.amend(line, quantity) : await this.counterDeclare(line, target, quantity);
      this.sheets().close();
      if (notice === null) {
        this.stamped.set(true);
        void this.voice.say([clip('corrected')]);
        setTimeout(() => this.stamped.set(false), STAMP_MS);
      } else {
        this.tell(notice);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private async amend(line: NamedLine, quantity: number): Promise<Notice | null> {
    try {
      // It may have left in the meantime: then it is locked like any sending in doubt.
      return (await this.sync.amend(line.id, quantity)) ? null : NOTICES.locked;
    } catch {
      return NOTICES.storageFull;
    }
  }

  private async counterDeclare(line: NamedLine, target: DeclarationTarget, quantity: number): Promise<Notice | null> {
    const answer = await this.sync.correct({
      siteId: target.siteId,
      campaignId: target.campaignId,
      businessDate: target.businessDate,
      recordedAt: this.clock.now().toISOString(),
      corrects: line.id,
      fact: { type: this.gesture().fact, quantity },
    });
    if (answer.kind === 'unreachable') {
      return NOTICES.needsNetwork;
    }
    // The server answered either way: the notebook reads it again, so that a line the chef took
    // back, or a closed campaign, shows as it stands — not with a pencil to try again.
    void this.notebook.refresh();
    const outcome = answer.kind === 'outcomes' ? answer.outcomes[0] : undefined;
    if (outcome === undefined || outcome.status === 'Refused') {
      return outcome?.status === 'Refused' && outcome.refusal.kind === 'CatchUpWindowPassed' ? NOTICES.tooOld : NOTICES.refused;
    }
    return null;
  }

  private tell(notice: Notice): void {
    this.notice.set(notice);
    void this.voice.say([clip(notice.clip)]);
    clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => this.notice.set(null), NOTICE_MS);
  }
}
