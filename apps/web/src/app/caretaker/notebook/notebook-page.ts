import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import type { BusinessDay } from '@domain/journal';
import { clip, counted, type PhrasePart } from '../../core/audio/phrase';
import { Voice } from '../../core/audio/voice';
import { JournalSync } from '../../core/sync/journal-sync';
import { SpeakerButton } from '../../ui/speaker-button';
import { DeathGesture } from '../gestures/death/death-gesture';
import { Pictogram } from '../../ui/pictogram';
import { PostIt } from '../../ui/post-it';
import { DayJournal, type NamedLine } from './day-journal';
import { DayStrip } from './day-strip';
import { DAY_NAMES, DayTabs } from './day-tabs';
import { CampaignChoice } from './campaign-choice';
import { Notebook } from './notebook';
import { NotebookCover } from './notebook-cover';

// The caretaker's notebook (epic J): the cover, then — once the campaign is known — the strip of
// the day, the three days, the past-day banner and the journal of the chosen day. Everything here
// opens offline from the last context received. The gestures write on the campaign and the day chosen (K).
@Component({
  selector: 'app-notebook-page',
  imports: [DayJournal, DayStrip, DayTabs, CampaignChoice, DeathGesture, NotebookCover, Pictogram, PostIt, SpeakerButton],
  providers: [Notebook],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="notebook">
      <app-notebook-cover [name]="notebook.account()?.name ?? ''" [avatar]="notebook.account()?.avatar ?? null" [siteName]="notebook.site()?.name ?? null" [primary]="notebook.isPrimaryCaretaker()" [waiting]="sync.waiting()" />

      @if (notebook.site() === null) {
        <section class="page">
          <app-post-it>
            <p class="notice" role="status">
              <app-pictogram [picto]="notebook.unreachable() ? 'sync-cloud' : 'barn'" [decorative]="true" />
              <span class="notice-words">{{ notebook.unreachable() ? 'Pas de réseau. Le cahier s’ouvrira au retour du réseau.' : notebook.context() === null ? 'Le cahier se prépare…' : 'Aucun poulailler pour toi. Parle au chef.' }}</span>
              @if (notebook.unreachable()) {
                <app-speaker-button phrase="sign-in-offline" />
              }
            </p>
          </app-post-it>
        </section>
      } @else if (notebook.campaigns().length === 0) {
        <section class="page">
          <app-post-it>
            <p class="notice" role="status"><app-pictogram picto="chick" [decorative]="true" /> <span class="notice-words">Pas de bande en cours dans ce poulailler.</span> <app-speaker-button phrase="no-campaign" /></p>
          </app-post-it>
        </section>
      } @else {
        @if (notebook.campaigns().length > 1) {
          <app-campaign-choice [campaigns]="notebook.campaigns()" [chosen]="notebook.campaign()?.campaignId ?? null" (choose)="chooseCampaign($event)" />
        }
        @if (notebook.campaign(); as campaign) {
          <section class="page" [class]="'page ' + campaign.tone" [class.several]="notebook.campaigns().length > 1">
            <app-day-strip [campaign]="campaign" [liveCount]="notebook.liveCount()" />
            <app-day-tabs [tabs]="notebook.tabs()" [chosen]="notebook.day()?.day ?? null" (choose)="chooseDay($event)" />
            @if (pastDay(); as when) {
              <div class="past" role="alert">
                <app-pictogram picto="moon" [decorative]="true" />
                <span class="past-words">Tu écris pour : {{ when }}</span>
                <button type="button" (click)="backToToday()">Aujourd'hui</button>
              </div>
            }
            @if (notebook.declarationTarget(); as target) {
              <div class="gestures" role="group" aria-label="Écrire dans le cahier">
                <app-death-gesture [target]="target" [when]="notebook.day()?.when ?? 'today'" [alreadyWritten]="notebook.deathsWritten()" />
              </div>
            }
            <app-day-journal [title]="journalTitle()" [lines]="lines()" />
          </section>
        }
      }
    </main>
  `,
  styles: `
    :host { display: block; min-block-size: 100dvh; background: var(--color-shell); }
    .page { display: block; padding: 12px 12px 80px; background-image: var(--notebook-lines); }
    .page.several.young { border-block-start: 6px solid var(--color-campaign-young); }
    .page.several.old { border-block-start: 6px solid var(--color-campaign-old); }
    .notice { display: flex; align-items: center; gap: 10px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .notice app-pictogram { inline-size: 34px; block-size: 34px; flex: none; }
    .notice-words { flex: 1; }
    .past {
      display: flex; align-items: center; gap: 10px; margin: 10px 0 0; padding: 10px 12px;
      background: var(--color-past-day-light); border: 2px dashed var(--color-past-day-line); color: var(--color-past-day); font-weight: 700; transform: rotate(-0.3deg);
    }
    .past app-pictogram { inline-size: 30px; block-size: 30px; flex: none; }
    .past-words { flex: 1; font-family: var(--font-hand); }
    .past button {
      flex: none; min-block-size: var(--touch-target-min); padding: 7px 11px; cursor: pointer;
      border: 2px solid var(--color-past-day); background: var(--color-paper); color: var(--color-past-day); font: 700 0.9rem var(--font-hand); box-shadow: var(--shadow-hard-sm);
    }
    .past button:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .gestures { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 14px 0; }
  `,
})
export class NotebookPage {
  protected readonly notebook = inject(Notebook);
  private readonly voice = inject(Voice);
  protected readonly sync = inject(JournalSync);

  /** « HIER », « AVANT-HIER » under the violet banner; nothing for today. */
  protected readonly pastDay = computed(() => {
    const day = this.notebook.day();
    return day === null || day.when === 'today' ? null : DAY_NAMES[day.when].toUpperCase();
  });
  protected readonly journalTitle = computed(() => DAY_NAMES[this.notebook.day()?.when ?? 'today']);
  protected readonly lines = computed((): NamedLine[] => this.notebook.lines().map((line) => ({ ...line, authorName: this.notebook.nameOf(line.authorId) })));

  protected backToToday(): void {
    const today = this.notebook.days()[2];
    if (today !== undefined) {
      this.chooseDay(today.day);
    }
  }

  /** Choosing a day says it; a past day warns aloud that one writes for it (J.2). */
  protected chooseDay(day: BusinessDay): void {
    this.notebook.chooseDay(day);
    const when = this.notebook.day()?.when;
    void this.voice.say([clip(when === 'yesterday' ? 'past-day-yesterday' : when === 'dayBeforeYesterday' ? 'past-day-before-yesterday' : 'day-today')]);
  }

  /** Choosing a flock says its name: « les petits », « les grands », or its age beyond two (J.1). */
  protected chooseCampaign(campaignId: string): void {
    this.notebook.chooseCampaign(campaignId);
    const chosen = this.notebook.campaign();
    if (chosen === null) {
      return;
    }
    const several = this.notebook.campaigns().length > 2;
    const phrase: PhrasePart = several ? counted('campaign-day', chosen.campaignDay) : clip(chosen.tone === 'young' ? 'campaign-young' : 'campaign-old');
    void this.voice.say([phrase]);
  }
}
