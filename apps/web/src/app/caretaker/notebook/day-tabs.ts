import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { BusinessDay, DaySummary } from '@domain/journal';
import { Pictogram } from '../../ui/pictogram';
import type { NotebookDay } from './notebook-view';

export type DayTab = NotebookDay & { readonly summary: DaySummary };

export const DAY_NAMES: Readonly<Record<NotebookDay['when'], string>> = { dayBeforeYesterday: 'Avant-hier', yesterday: 'Hier', today: "Aujourd'hui" };

/** « 5 nov. », read from the business day as written, whatever the phone's time zone. */
export const shortDate = (day: BusinessDay): string => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));

// The three days (J.2, journal-gardien.html .jours): each tab sums its day up at a glance. A day
// with nothing written and a day with « nothing lost » never look alike: a question mark for a
// past day left blank, a faint sun for today not yet written, the stamp for an explicit zero.
@Component({
  selector: 'app-day-tabs',
  imports: [Pictogram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="days" role="tablist" aria-label="Choisir le jour">
      @for (tab of tabs(); track tab.day) {
        <button type="button" role="tab" class="day" [class.active]="tab.day === chosen()" [attr.aria-selected]="tab.day === chosen()" [attr.aria-label]="wordsOf(tab)" (click)="choose.emit(tab.day)">
          <span class="name">{{ names[tab.when] }}</span>
          <span class="date">{{ dateOf(tab.day) }}</span>
          <span class="mini">
            @switch (tab.summary.mortality.kind) {
              @case ('DeathsDeclared') {
                <span class="deaths"><app-pictogram class="dead" picto="dead-chicken" [decorative]="true" /><b>{{ deathsOf(tab) }}</b></span>
              }
              @case ('NoLossDeclared') {
                <app-pictogram class="zero" picto="stamp-done" [decorative]="true" />
              }
              @default {
                @if (bagsOf(tab) === 0) {
                  @if (tab.when === 'today') {
                    <app-pictogram class="blank" picto="sun" [decorative]="true" />
                  } @else {
                    <app-pictogram class="missing" picto="question" [decorative]="true" />
                  }
                }
              }
            }
            @if (bagsOf(tab) > 0) {
              <span class="bags"><app-pictogram class="bag" picto="open-bag" [decorative]="true" /><b>{{ bagsOf(tab) }}</b></span>
            }
          </span>
        </button>
      }
    </div>
  `,
  styles: `
    :host { display: block; }
    .days { display: grid; grid-template-columns: 1fr 1fr 1.2fr; gap: 8px; margin: 10px 0 0; }
    .day {
      min-block-size: var(--touch-target-min); padding: 5px 4px; display: flex; flex-direction: column; align-items: center; gap: 2px;
      background: var(--color-paper); border: 2px solid var(--color-card-edge); box-shadow: var(--shadow-hard-sm);
      font-family: var(--font-reading); color: var(--color-muted); cursor: pointer;
    }
    .day:nth-child(1) { transform: rotate(0.5deg); }
    .day:nth-child(2) { transform: rotate(-0.6deg); }
    .day:nth-child(3) { transform: rotate(0.3deg); }
    .day.active { border: 3px solid var(--color-earth); background: var(--color-straw); color: var(--color-earth); box-shadow: var(--shadow-hard); }
    .day:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .name { font: 700 0.92rem var(--font-hand); }
    .date { font-size: 0.7rem; }
    .mini { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 8px; min-block-size: 24px; }
    .mini > span { display: flex; align-items: center; gap: 3px; }
    .mini b { font: 700 1rem var(--font-hand); color: var(--color-ink); }
    .dead { inline-size: 33px; block-size: 21px; }
    .bag { inline-size: 16px; block-size: 19px; }
    .zero, .missing { inline-size: 23px; block-size: 23px; }
    .blank { inline-size: 21px; block-size: 21px; opacity: 0.35; }
  `,
})
export class DayTabs {
  readonly tabs = input.required<readonly DayTab[]>();
  readonly chosen = input<BusinessDay | null>(null);
  readonly choose = output<BusinessDay>();
  protected readonly names = DAY_NAMES;

  protected dateOf(day: BusinessDay): string {
    return shortDate(day);
  }

  protected deathsOf(tab: DayTab): number {
    return tab.summary.mortality.kind === 'DeathsDeclared' ? tab.summary.mortality.deaths : 0;
  }

  protected bagsOf(tab: DayTab): number {
    return tab.summary.bagsOpened.reduce((sum, entry) => sum + entry.quantity, 0);
  }

  protected wordsOf(tab: DayTab): string {
    const { mortality } = tab.summary;
    const deaths = mortality.kind === 'DeathsDeclared' ? `${mortality.deaths} ${mortality.deaths > 1 ? 'morts' : 'mort'}` : mortality.kind === 'NoLossDeclared' ? 'rien perdu' : 'morts pas encore écrits';
    const bags = this.bagsOf(tab);
    return `${DAY_NAMES[tab.when]}, ${this.dateOf(tab.day)} : ${deaths}${bags > 0 ? `, ${bags} ${bags > 1 ? 'sacs ouverts' : 'sac ouvert'}` : ''}`;
  }
}
