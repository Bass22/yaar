import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { CampaignDayView, FactPayload, OfficeJournalLine } from '@contracts';
import { CLOCK } from '../../core/clock';
import { JournalSync } from '../../core/sync/journal-sync';
import type { SyncAnswer } from '../../core/sync/synchronize';
import { Pictogram } from '../../ui/pictogram';
import { FiguresAge } from '../figures-age';
import { PhotosComponent } from '../photos';
import { CurrentLot, currentLotOf } from '../lots/current-lot';
import { Office } from '../office';
import { typedNumber, typedText } from '../typed-number';
import { CampaignJournal } from './campaign-journal';

/** What the office writes in the place of a caretaker (O.7): the gestures of the notebook, and the losses that are the admin's. */
type AddedKind = 'Death' | 'BagOpened' | 'NoLoss' | 'Missing' | 'Donation' | 'Theft';
const KINDS: readonly { readonly kind: AddedKind; readonly word: string }[] = [
  { kind: 'Death', word: 'Morts' },
  { kind: 'BagOpened', word: 'Sacs ouverts' },
  { kind: 'NoLoss', word: 'Rien perdu' },
  { kind: 'Missing', word: 'Manquants' },
  { kind: 'Donation', word: 'Dons' },
  { kind: 'Theft', word: 'Vols' },
];

const REFUSALS: Readonly<Record<string, string>> = {
  CampaignClosed: 'La bande est close : son journal ne s’écrit plus.',
  FutureBusinessDate: 'Ce jour n’est pas encore arrivé.',
  BusinessDateBeforePlacement: 'Ce jour est avant la mise en place.',
  AlreadyRetracted: 'Cette déclaration est déjà annulée.',
};

const plural = (count: number, one: string, many: string): string => `${count} ${count > 1 ? many : one}`;

/** A fact in the office's words: « 3 morts », « 2 sacs ouverts », « Rien perdu »… */
export function factWords(fact: FactPayload, deliveryName?: string): string {
  switch (fact.type) {
    case 'Death':
      return plural(fact.quantity, 'mort', 'morts');
    case 'BagOpened':
      return plural(fact.quantity, 'sac ouvert', 'sacs ouverts');
    case 'NoLoss':
      return 'Rien perdu';
    case 'Loss':
      return fact.lossType === 'Missing' ? plural(fact.quantity, 'manquant', 'manquants') : fact.lossType === 'Donation' ? plural(fact.quantity, 'don', 'dons') : plural(fact.quantity, 'vol', 'vols');
    case 'Delivery':
      return `${fact.receivedQuantity} reçu${fact.receivedQuantity > 1 ? 's' : ''}${deliveryName === undefined ? '' : ' : ' + deliveryName}`;
    case 'Weighing':
      return `Pesée de ${plural(fact.weights.length, 'poulet', 'poulets')}`;
    case 'WeighingValidated':
      return 'Pesée validée';
    case 'TaskDone':
      return 'Tâche faite';
    case 'VoiceMessage':
      return 'Message vocal';
    case 'Photo':
      return 'Photo';
  }
}

/** The number a correction changes, when there is one: deaths, bags, losses, a delivery's count. */
const countOf = (fact: FactPayload): number | null => ('quantity' in fact ? fact.quantity : fact.type === 'Delivery' ? fact.receivedQuantity : null);
const withCount = (fact: FactPayload, count: number): FactPayload => (fact.type === 'Delivery' ? { ...fact, receivedQuantity: count } : { ...fact, quantity: count } as FactPayload);

// The journal of the lot at the office (O.7; CLAUDE.md §4 rule 1): every declaration, the latest
// day first. Nothing is ever erased: a correction writes a counter-declaration — the old value stays
// readable —, a retraction is written, final. Correcting and taking back need the network; a
// declaration written in the place of a caretaker leaves from the outbox, offline too (rule 3).
@Component({
  selector: 'app-journal-page',
  imports: [CurrentLot, FiguresAge, PhotosComponent, Pictogram, RouterLink],
  providers: [CampaignJournal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1><app-pictogram picto="paper" [decorative]="true" /> Journal</h1>
    <a class="back" routerLink="..">Revenir aux lots</a>
    <app-current-lot />
    <app-figures-age [readAt]="journal.readAt()" [stale]="journal.unreachable()" />

    @if (journal.view(); as view) {
      <section class="calendar" aria-label="Le calendrier de la bande">
        @for (week of weeks(); track week.index) {
          <div class="week">
            <button type="button" class="week-label" (click)="chooseWeek(week.days)">Semaine {{ week.index + 1 }}</button>
            <div class="cells">
              @for (cell of week.days; track cell.day) {
                <div class="cell" [attr.data-day]="'J' + cell.campaignDay" [class]="'cell ' + tone(cell)" [class.chosen]="inRange(cell.day)">
                  <button type="button" (click)="chooseDay(cell.day)" [attr.aria-pressed]="inRange(cell.day)">
                    <b>J{{ cell.campaignDay }}</b>&ngsp;
                    <span class="said"><app-pictogram [picto]="picto(cell)" [decorative]="true" />{{ said(cell) }}</span>
                    @if (cell.bagsOpened > 0) {
                      &ngsp;<span class="bags">{{ cell.bagsOpened }} sac{{ cell.bagsOpened > 1 ? 's' : '' }}</span>
                    }
                  </button>
                </div>
              }
            </div>
          </div>
        }
      </section>
      @if (range(); as chosen) {
        <p class="filter">{{ rangeWords(chosen) }}&ngsp;<button type="button" (click)="range.set(null)">tout voir</button></p>
      }
      @if (!view.closed) {
        @if (adding()) {
          <form class="add-form" (submit)="add($event)">
            <label class="field">
              <span>Le jour</span>
              <input name="businessDate" type="date" [min]="view.placementDay" [max]="view.today" [value]="day()" (input)="day.set(valueOf($event))" />
            </label>
            <div class="kinds" role="radiogroup" aria-label="Ce qui est déclaré">
              @for (choice of kinds; track choice.kind) {
                <label class="kind"><input type="radio" name="kind" [value]="choice.kind" [checked]="kind() === choice.kind" (change)="kind.set(choice.kind)" /> {{ choice.word }}</label>
              }
            </div>
            @if (kind() !== 'NoLoss') {
              <label class="field">
                <span>Combien ?</span>
                <input name="quantity" type="text" inputmode="numeric" autocomplete="off" [value]="quantity()" (input)="quantity.set(typedNumber($event))" />
              </label>
            }
            @if (addProblem(); as said) {
              <p class="refusal" role="alert">{{ said }}</p>
            }
            <div class="actions">
              <button type="submit" class="write">Écrire</button>
              <button type="button" class="cancel" (click)="adding.set(false)">Fermer</button>
            </div>
          </form>
        } @else {
          <button type="button" class="add" (click)="openAdd()">Ajouter une déclaration</button>
        }
      }

      @for (group of days(); track group.day) {
        <section class="day">
          <h2>{{ group.title }}</h2>
          <ul>
            @for (line of group.lines; track line.id) {
              <li class="line" [attr.data-id]="line.id" [class.retracted]="line.retraction !== null">
                <p class="what">{{ what(line) }}</p>
                <p class="who">{{ who(line) }}</p>
                @if (deliveryNoteOf(line); as note) {
                  <!-- The paper of a delivery, photographed by the caretaker (R.6) -->
                  <app-photos [photos]="[note]" label="Bon de livraison" />
                }
                @if (!view.closed && line.retraction === null) {
                  @if (editing() === line.id) {
                    <div class="edit">
                      @if (count(line) !== null) {
                        <label class="field"><span>Le bon nombre</span><input name="quantity" type="text" inputmode="numeric" autocomplete="off" [value]="correction()" (input)="correction.set(typedNumber($event))" /></label>
                        <button type="button" class="write" [disabled]="busy()" (click)="correct(line)">Écrire la correction</button>
                      }
                      <button type="button" class="cancel" (click)="close()">Fermer</button>
                    </div>
                  } @else if (confirming() === line.id) {
                    <div class="confirm" role="alert">
                      <span>Annuler cette déclaration ? C’est définitif : elle restera écrite, mais ne comptera plus.</span>
                      <button type="button" class="confirm-retract" [disabled]="busy()" (click)="retract(line)">Oui, annuler</button>
                      <button type="button" class="cancel" (click)="close()">Non</button>
                    </div>
                  } @else {
                    <div class="actions">
                      @if (count(line) !== null) {
                        <button type="button" class="correct" (click)="openCorrection(line)">Corriger</button>
                      }
                      <button type="button" class="retract" (click)="openRetraction(line)">Annuler</button>
                    </div>
                  }
                  @if (problemOf()?.id === line.id) {
                    <p class="refusal" role="alert">{{ problemOf()?.words }}</p>
                  }
                }
              </li>
            }
          </ul>
        </section>
      } @empty {
        <p class="hint">Rien n’est encore écrit au journal de cette bande.</p>
      }
    }
  `,
  styles: `
    :host { display: block; }
    h1 { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; font: 700 1.35rem var(--font-hand); color: var(--color-earth); }
    h1 app-pictogram { inline-size: 36px; block-size: 36px; }
    .back { display: inline-flex; align-items: center; min-block-size: 44px; color: var(--color-ink); font-weight: 700; }
    .hint { color: var(--color-muted); }
    .calendar { display: grid; gap: 6px; margin: 8px 0; }
    .week { display: grid; gap: 4px; }
    .week-label { justify-self: start; min-block-size: 32px; padding: 0 8px; border: none; background: transparent; color: var(--color-earth); font: 700 0.95rem var(--font-hand); cursor: pointer; text-decoration: underline; }
    .cells { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; }
    .cell button { inline-size: 100%; min-block-size: 56px; padding: 4px 2px; display: grid; justify-items: center; gap: 2px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font-size: 0.7rem; line-height: 1.1; cursor: pointer; }
    .cell b { font-size: 0.8rem; }
    .cell .said { display: grid; justify-items: center; gap: 1px; }
    .cell app-pictogram { inline-size: 18px; block-size: 18px; }
    .cell.not-declared button { border-color: var(--color-alert); background: var(--color-orange-light); }
    .cell.no-loss button { border-color: var(--color-pasture); }
    .cell.deaths button { border-color: var(--color-earth); }
    .cell.chosen button { outline: 3px solid var(--color-blue); outline-offset: 1px; }
    .bags { color: var(--color-muted); }
    .filter { display: flex; align-items: center; gap: 8px; margin: 6px 0; font-weight: 700; color: var(--color-ink); }
    .filter button { min-block-size: 40px; border: none; background: transparent; color: var(--color-ink); text-decoration: underline; font-weight: 700; cursor: pointer; }
    .day h2 { margin: 16px 0 6px; font: 700 1.05rem var(--font-hand); color: var(--color-earth); text-transform: capitalize; }
    ul { list-style: none; margin: 0; padding: 0; }
    .line { padding: 10px 12px; margin-block-end: 8px; background: var(--color-shell); border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-2); box-shadow: var(--shadow-hard-sm); }
    .line.retracted { opacity: 0.7; }
    .line.retracted .what { text-decoration: line-through; }
    .what { margin: 0; font: 700 1.1rem var(--font-hand); color: var(--color-ink); }
    .who { margin: 2px 0 0; color: var(--color-muted); font-size: 0.9rem; }
    .actions, .edit, .confirm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-block-start: 8px; }
    .confirm span { flex-basis: 100%; font-weight: 700; color: var(--color-ink); }
    button { min-block-size: 44px; padding: 0 14px; border: 2px solid var(--color-ink); border-radius: var(--radius-wobble-1); background: var(--color-paper); color: var(--color-ink); font-weight: 700; cursor: pointer; }
    button.write, button.add { background: var(--color-pasture); color: var(--color-on-sign); }
    button.confirm-retract { background: var(--color-alert); color: var(--color-on-sign); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .add { inline-size: 100%; margin-block: 8px; font: 700 1rem var(--font-hand); }
    .add-form { display: grid; gap: 10px; padding: 12px; margin-block: 8px; background: var(--color-shell); border: 2px dashed var(--color-card-edge); border-radius: 4px; }
    .field { display: grid; gap: 4px; font-weight: 700; color: var(--color-ink); }
    .field input { min-block-size: 44px; padding: 0 8px; border: 2px solid var(--color-card-edge); border-radius: 4px; background: var(--color-paper); color: var(--color-ink); font: 700 1.05rem var(--font-hand); }
    .kinds { display: flex; flex-wrap: wrap; gap: 6px; }
    .kind { position: relative; display: inline-flex; align-items: center; min-block-size: 44px; padding: 0 12px; border: 2px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); background: var(--color-paper); font-weight: 700; color: var(--color-ink); cursor: pointer; }
    .kind input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .kind:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture); color: var(--color-on-sign); }
    .refusal { margin: 8px 0 0; padding: 8px 10px; border-inline-start: 4px solid var(--color-alert); background: var(--color-orange-light); color: var(--color-ink); font-weight: 700; }
    a:focus-visible, button:focus-visible, input:focus-visible, .kind:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
  `,
})
export class JournalPage {
  protected readonly journal = inject(CampaignJournal);
  private readonly sync = inject(JournalSync);
  private readonly office = inject(Office);
  private readonly route = inject(ActivatedRoute);
  private readonly clock = inject(CLOCK);

  protected readonly lotId = currentLotOf(this.office, this.route);
  protected readonly kinds = KINDS;
  protected readonly typedNumber = typedNumber;

  protected readonly adding = signal(false);
  protected readonly day = signal('');
  protected readonly kind = signal<AddedKind>('Death');
  protected readonly quantity = signal('');
  protected readonly addProblem = signal<string | null>(null);

  protected readonly editing = signal<string | null>(null);
  protected readonly confirming = signal<string | null>(null);
  protected readonly correction = signal('');
  protected readonly busy = signal(false);
  protected readonly problemOf = signal<{ readonly id: string; readonly words: string } | null>(null);

  /** The days chosen on the calendar (O.8): one, a range, a week; `null`, the whole flock. */
  protected readonly range = signal<{ readonly from: string; readonly to: string } | null>(null);

  /** The calendar by weeks of seven days, from J0. */
  protected readonly weeks = computed(() => {
    const days = this.journal.view()?.days ?? [];
    return Array.from({ length: Math.ceil(days.length / 7) }, (_, index) => ({ index, days: days.slice(index * 7, index * 7 + 7) }));
  });

  /** The lines by day, the latest first, each day titled « jeudi 12 novembre · J31 » — those of the days chosen. */
  protected readonly days = computed(() => {
    const view = this.journal.view();
    if (view === null) return [];
    const range = this.range();
    const groups = new Map<string, OfficeJournalLine[]>();
    for (const line of view.lines) {
      if (range !== null && (line.businessDate < range.from || line.businessDate > range.to)) continue;
      groups.set(line.businessDate, [...(groups.get(line.businessDate) ?? []), line]);
    }
    const format = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return [...groups].map(([day, lines]) => ({ day, lines, title: `${format.format(new Date(day))} · J${Math.round((Date.parse(day) - Date.parse(view.placementDay)) / 86_400_000)}` }));
  });

  constructor() {
    effect(() => {
      const lot = this.lotId();
      if (lot !== '') untracked(() => void this.journal.load(lot));
    });
  }

  /** A tap on a day: that day alone; a second tap on another day, the range between them (O.8). */
  protected chooseDay(day: string): void {
    const range = this.range();
    if (range !== null && range.from === range.to && range.from !== day) {
      this.range.set(day < range.from ? { from: day, to: range.from } : { from: range.from, to: day });
    } else {
      this.range.set({ from: day, to: day });
    }
  }

  protected chooseWeek(days: readonly CampaignDayView[]): void {
    const first = days[0];
    const last = days.at(-1);
    if (first !== undefined && last !== undefined) this.range.set({ from: first.day, to: last.day });
  }

  protected inRange(day: string): boolean {
    const range = this.range();
    return range !== null && day >= range.from && day <= range.to;
  }

  protected rangeWords({ from, to }: { readonly from: string; readonly to: string }): string {
    const label = (day: string) => `J${this.journal.view()?.days.find((cell) => cell.day === day)?.campaignDay ?? ''}`;
    return from === to ? label(from) : `du ${label(from)} au ${label(to)}`;
  }

  /** Today, nothing written yet: the day is not over, it is no gap yet (founder, 2026-11-13). */
  private inProgress(cell: CampaignDayView): boolean {
    const view = this.journal.view();
    return cell.mortality.kind === 'NotDeclared' && view !== null && !view.closed && cell.day === view.today;
  }

  /** Nothing written is a gap to fill: picto, colour and word (CLAUDE.md rule 10). */
  protected tone(cell: CampaignDayView): string {
    if (this.inProgress(cell)) return 'today';
    return cell.mortality.kind === 'NotDeclared' ? 'not-declared' : cell.mortality.kind === 'NoLossDeclared' ? 'no-loss' : 'deaths';
  }

  protected picto(cell: CampaignDayView): 'sun' | 'question' | 'check' | 'dead-chicken' {
    if (this.inProgress(cell)) return 'sun';
    return cell.mortality.kind === 'NotDeclared' ? 'question' : cell.mortality.kind === 'NoLossDeclared' ? 'check' : 'dead-chicken';
  }

  protected said(cell: CampaignDayView): string {
    const { mortality } = cell;
    if (this.inProgress(cell)) return 'en cours';
    return mortality.kind === 'NotDeclared' ? 'rien écrit' : mortality.kind === 'NoLossDeclared' ? 'rien perdu' : `${mortality.deaths} mort${mortality.deaths > 1 ? 's' : ''}`;
  }

  protected valueOf(event: Event): string {
    return typedText(event);
  }

  protected what(line: OfficeJournalLine): string {
    const declared = factWords(line.declared, line.delivery?.name);
    if (line.correction === null || line.fact === null) return declared;
    const before = countOf(line.declared);
    const after = countOf(line.fact);
    return before !== null && after !== null ? `${before} → ${factWords(line.fact, line.delivery?.name)}` : factWords(line.fact, line.delivery?.name);
  }

  /** The photographed paper of a delivery, when there is one (R.6). */
  protected deliveryNoteOf(line: OfficeJournalLine): string | null {
    const fact = line.fact ?? line.declared;
    return fact.type === 'Delivery' && fact.deliveryNote.kind === 'Photographed' ? fact.deliveryNote.media : null;
  }

  protected who(line: OfficeJournalLine): string {
    const parts = [`par ${line.author.name}`];
    if (line.correction !== null) parts.push(`corrigé par ${line.correction.author.name}`);
    if (line.retraction !== null) parts.push(`annulé par ${line.retraction.author.name}`);
    return parts.join(' · ');
  }

  protected count(line: OfficeJournalLine): number | null {
    return line.fact === null ? null : countOf(line.fact);
  }

  protected openAdd(): void {
    // The day chosen on the calendar, when one alone is chosen; else today.
    const range = this.range();
    this.day.set(range !== null && range.from === range.to ? range.from : (this.journal.view()?.today ?? ''));
    this.addProblem.set(null);
    this.adding.set(true);
  }

  protected openCorrection(line: OfficeJournalLine): void {
    this.close();
    this.correction.set(String(this.count(line) ?? ''));
    this.editing.set(line.id);
  }

  protected openRetraction(line: OfficeJournalLine): void {
    this.close();
    this.confirming.set(line.id);
  }

  protected close(): void {
    this.editing.set(null);
    this.confirming.set(null);
    this.problemOf.set(null);
  }

  protected async correct(line: OfficeJournalLine): Promise<void> {
    const count = Number(this.correction());
    if (line.fact === null || this.correction() === '' || !Number.isSafeInteger(count)) return;
    const fact = withCount(line.fact, count);
    await this.answer(line, this.sync.correct({ siteId: line.siteId, campaignId: this.lotId(), businessDate: line.businessDate, recordedAt: this.clock.now().toISOString(), corrects: line.id, fact }));
  }

  protected async retract(line: OfficeJournalLine): Promise<void> {
    await this.answer(line, this.sync.retract({ siteId: line.siteId, campaignId: this.lotId(), businessDate: line.businessDate, recordedAt: this.clock.now().toISOString(), retracts: line.id }));
  }

  protected async add(event: Event): Promise<void> {
    event.preventDefault();
    const view = this.journal.view();
    if (view === null) return;
    const kind = this.kind();
    const quantity = Number(this.quantity());
    if (kind !== 'NoLoss' && (this.quantity() === '' || !Number.isSafeInteger(quantity) || quantity < 1)) return this.addProblem.set('Écris combien : un nombre entier, au moins 1.');
    if (this.day() < view.placementDay || this.day() > view.today) return this.addProblem.set('Choisis un jour de la bande, au plus aujourd’hui.');
    const fact: FactPayload = kind === 'NoLoss' ? { type: 'NoLoss' } : kind === 'Death' || kind === 'BagOpened' ? { type: kind, quantity } : { type: 'Loss', lossType: kind, quantity };
    try {
      // Kept on this computer first, then sent: offline too (rule 3).
      await this.sync.record({ siteId: view.siteId, campaignId: view.campaignId, businessDate: this.day(), recordedAt: this.clock.now().toISOString(), fact });
    } catch {
      return this.addProblem.set('Cet ordinateur ne peut pas garder la déclaration : réessaie.');
    }
    this.adding.set(false);
    this.quantity.set('');
    await this.sync.sync();
    await this.journal.load(view.campaignId);
  }

  // A correction or a retraction: nothing kept when it does not reach the server — the admin tries again.
  private async answer(line: OfficeJournalLine, answering: Promise<SyncAnswer>): Promise<void> {
    this.busy.set(true);
    const answer = await answering;
    this.busy.set(false);
    if (answer.kind === 'unreachable') return this.problemOf.set({ id: line.id, words: 'Pas de réseau : corriger et annuler demandent le réseau. Réessaie.' });
    if (answer.kind === 'unauthorized') return this.problemOf.set({ id: line.id, words: 'Ta session a expiré : reconnecte-toi.' });
    const outcome = answer.outcomes[0];
    if (outcome?.status === 'Refused') {
      return this.problemOf.set({ id: line.id, words: REFUSALS[outcome.refusal.kind] ?? `Le serveur a refusé (${outcome.refusal.kind}).` });
    }
    this.close();
    await this.journal.load(this.lotId());
  }
}
