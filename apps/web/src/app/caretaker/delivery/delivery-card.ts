import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, signal, viewChild } from '@angular/core';
import type { PictogramName } from '@design-system';
import type { CaretakerDeliveryLine } from '@contracts';
import { deliveryCounting, receivedOf, type CountingUnit, type DeliveryCounting } from '@domain/journal';
import { clip, number, type PhrasePart } from '../../core/audio/phrase';
import type { ScriptClip } from '../../core/audio/script-clips';
import { Voice } from '../../core/audio/voice';
import { CLOCK } from '../../core/clock';
import { MediaQueueFull } from '../../core/outbox/media-queue';
import { JournalSync } from '../../core/sync/journal-sync';
import { Counter } from '../../ui/counter';
import { Pictogram } from '../../ui/pictogram';
import { Pile } from '../../ui/pile';
import { PostIt } from '../../ui/post-it';
import { Sheet } from '../../ui/sheet';
import { SpeakerButton } from '../../ui/speaker-button';
import { Stamp, STAMP_MS } from '../../ui/stamp';
import { REDUCE_PHOTO } from '../../core/media/reduce-photo';
import type { DeclarationTarget } from '../notebook/notebook';
import { DELIVERED_PICTO } from '../notebook/day-journal';

/** The stage of a feed (N.9; founder's decisions of 2026-11-13): the colour of its bag, the words the voice says first. */
const STAGE: Record<NonNullable<CaretakerDeliveryLine['feedStage']>, { readonly css: string; readonly clip: ScriptClip }> = {
  Starter: { css: 'stage-starter', clip: 'feed-starter' },
  Grower: { css: 'stage-grower', clip: 'feed-grower' },
  Finisher: { css: 'stage-finisher', clip: 'feed-finisher' },
};

/** What is counted, said for a number: « 8 sacs », « 21 cartons », « 6 ». */
const UNIT_WORDS: Record<CountingUnit, readonly [string, string]> = { bag: ['sac', 'sacs'], box: ['carton', 'cartons'], unit: ['', ''] };
const HOW_MANY: Record<CountingUnit, ScriptClip> = { bag: 'delivery-how-many', box: 'delivery-how-many-boxes', unit: 'delivery-how-many-units' };
const RECEIVED: Record<CountingUnit, ScriptClip> = { bag: 'delivery-received', box: 'delivery-received-boxes', unit: 'delivery-received-units' };

export const unitWords = (count: number, unit: CountingUnit): string => {
  const word = UNIT_WORDS[unit][count > 1 ? 1 : 0];
  return word === '' ? String(count) : `${count} ${word}`;
};

type Counted = { readonly line: CaretakerDeliveryLine; readonly counting: DeliveryCounting; readonly count: number };
type Step = 'closed' | 'choose' | 'count' | 'confirm' | 'paper';
type Trouble = 'camera' | 'full' | 'storage';

/**
 * The delivery card and its gesture (Q.7, Q.8; CdC « Livraison annoncée », decisions of
 * 2026-11-11): what the chef ordered and is still to come; « C'est arrivé » → what the truck
 * brought → each line counted, from what is still to come, in what one counts (bags, boxes of
 * fifty chicks, items) → the read-back says a shortfall or a bonus → the driver's paper, photographed
 * or not, once for the whole arrival → one delivery per line written in the notebook. No price
 * ever: the phone only knows quantities (rule 4).
 */
@Component({
  selector: 'app-delivery-card',
  imports: [Counter, Pictogram, Pile, PostIt, Sheet, SpeakerButton, Stamp],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (lines().length > 0) {
      <section class="card" aria-label="Livraison annoncée">
        <p class="head">
          <app-pictogram picto="truck" [decorative]="true" />
          <span>Le chef a commandé</span>
          <app-speaker-button phrase="delivery-announced" />
        </p>
        <ul class="expected">
          @for (line of lines(); track line.orderLineId) {
            <li [class]="stageOf(line)">
              <app-pictogram [picto]="pictoOf(line)" [decorative]="true" />
              <span class="name">{{ line.name }}</span>&ngsp;<span class="left">{{ leftWords(line) }}</span>
            </li>
          }
        </ul>
        <button type="button" class="arrive" (click)="start()"><app-pictogram picto="check" [decorative]="true" /> C'est arrivé — je compte</button>
      </section>
    }
    @if (trouble(); as trouble) {
      <app-post-it class="trouble">
        <p role="alert"><app-pictogram [picto]="trouble === 'full' ? 'sync-cloud' : trouble === 'camera' ? 'camera' : 'cross'" [decorative]="true" /> {{ troubleWords[trouble] }}</p>
      </app-post-it>
    }
    <input #camera class="camera" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" (change)="paperTaken($event)" />
    <div class="layer">
      <app-sheet [open]="step() === 'choose'" title="Qu'est-ce qui est arrivé ?" (closed)="close()">
        <p class="title">Qu'est-ce qui est arrivé ?</p>
        <div class="tiles">
          @for (line of lines(); track line.orderLineId) {
            <label [class]="'tile ' + stageOf(line)">
              <input type="checkbox" [checked]="chosen().has(line.orderLineId)" (change)="toggle(line.orderLineId)" />
              <app-pictogram [picto]="pictoOf(line)" [decorative]="true" />
              <span>{{ line.name }}</span>
            </label>
          }
        </div>
        <div class="actions">
          <button type="button" class="no" (click)="close()" aria-label="Fermer sans rien écrire"><app-pictogram picto="cross" [decorative]="true" /></button>
          <button type="button" class="yes" [disabled]="chosen().size === 0" (click)="countChosen()"><app-pictogram picto="check" [decorative]="true" /> Je compte</button>
        </div>
      </app-sheet>

      <app-sheet [open]="step() === 'count'" [title]="current()?.line?.name ?? ''" (closed)="close()">
        @if (current(); as now) {
          <p [class]="'title ' + stageOf(now.line)"><app-pictogram [picto]="pictoOf(now.line)" [decorative]="true" /> {{ now.line.name }}</p>
          <p class="hint">Le chef attend {{ unitWords(now.counting.expected, now.counting.unit) }}</p>
          <app-counter [class]="stageOf(now.line)" [value]="count()" (valueChange)="count.set($event)" [unit]="unitWord(now.counting.unit)">
            @if (now.counting.unit === 'bag') {
              <app-pile kind="delivery" [count]="count()" [label]="unitWords(count(), 'bag')" />
            } @else {
              <p class="drawn"><app-pictogram [picto]="pictoOf(now.line)" [decorative]="true" /></p>
            }
          </app-counter>
          <div class="actions">
            <button type="button" class="no" (click)="close()" aria-label="Fermer sans rien écrire"><app-pictogram picto="cross" [decorative]="true" /></button>
            <button type="button" class="yes" (click)="readBack()"><app-pictogram picto="check" [decorative]="true" /> C'est tout</button>
          </div>
        }
      </app-sheet>

      <app-sheet [open]="step() === 'confirm'" title="C'est bien ça ?" (closed)="backToCount()">
        @if (current(); as now) {
          <p class="title">C'est bien ça ?</p>
          <p class="drawn"><app-pictogram [picto]="pictoOf(now.line)" [decorative]="true" /></p>
          <p class="phrase">{{ unitWords(count(), now.counting.unit) }} reçus</p>
          @if (variance(); as variance) {
            <p class="variance" [class.short]="variance.kind === 'short'" [class.bonus]="variance.kind === 'bonus'">{{ variance.words }}</p>
          }
          <div class="actions">
            <button type="button" class="no" (click)="backToCount()"><app-pictogram picto="cross" [decorative]="true" /> Non</button>
            <button type="button" class="yes" (click)="confirm()"><app-pictogram picto="check" [decorative]="true" /> Oui</button>
          </div>
        }
      </app-sheet>

      <app-sheet [open]="step() === 'paper'" title="Le papier du livreur" (closed)="close()">
        <p class="title"><app-pictogram picto="paper" [decorative]="true" /> Le papier du livreur</p>
        <div class="viewfinder" [class.taken]="paperPreview() !== null">
          @if (paperPreview(); as url) {
            <img [src]="url" alt="La photo du papier" />
          } @else {
            <app-pictogram picto="paper" [decorative]="true" />
          }
        </div>
        <div class="actions">
          @if (paperPreview() === null) {
            <button type="button" class="no paper-none" [disabled]="saving()" (click)="write(null)">Pas de papier</button>
            <button type="button" class="yes paper-photo" (click)="shootPaper()"><app-pictogram picto="camera-white" [decorative]="true" /> Photo du papier</button>
          } @else {
            <button type="button" class="no" (click)="forgetPaper()" aria-label="Reprendre la photo"><app-pictogram picto="cross" [decorative]="true" /></button>
            <button type="button" class="yes" [disabled]="saving()" (click)="write(paper)"><app-pictogram picto="check" [decorative]="true" /> Oui</button>
          }
        </div>
      </app-sheet>
      <app-stamp [shown]="stamped()" />
    </div>
  `,
  styles: `
    :host { display: block; }
    /* The bag of each feed in the colour of its stage (N.9) — to show a caretaker before adopting it */
    .stage-starter { --feed-bag: var(--color-corn); --feed-bag-tie: var(--color-kraft); }
    .stage-grower { --feed-bag: var(--color-pasture); --feed-bag-tie: var(--color-pasture-light); }
    .stage-finisher { --feed-bag: var(--color-earth); --feed-bag-tie: var(--color-kraft); }
    .card {
      margin: 14px 0; padding: 12px 14px; background: var(--color-pasture-light);
      border: 3px solid var(--color-pasture); border-radius: var(--radius-wobble-3); box-shadow: var(--shadow-hard-sm); transform: rotate(-0.4deg);
    }
    .head { display: flex; align-items: center; gap: 10px; margin: 0 0 8px; font: 700 1.1rem var(--font-hand); color: var(--color-pasture); }
    .head app-pictogram { inline-size: 42px; block-size: 37px; flex: none; }
    .head span { flex: 1; }
    .expected { list-style: none; margin: 0 0 10px; padding: 0; display: grid; gap: 6px; }
    .expected li { display: flex; align-items: center; gap: 10px; font-weight: 700; color: var(--color-earth); }
    .expected app-pictogram { inline-size: 34px; block-size: 34px; flex: none; }
    .expected .name { flex: 1; min-inline-size: 0; }
    .expected .left { font: 700 1.05rem var(--font-hand); white-space: nowrap; }
    .arrive {
      inline-size: 100%; min-block-size: 64px; display: flex; align-items: center; justify-content: center; gap: 10px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard);
      background: var(--color-pasture); color: var(--color-on-sign); font: 700 1.15rem var(--font-hand);
    }
    .arrive app-pictogram { inline-size: 28px; block-size: 28px; }
    .arrive:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .arrive:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .trouble { display: block; margin: 10px 0; }
    .trouble p { display: flex; align-items: center; gap: 8px; margin: 0; font: 700 1rem var(--font-hand); color: var(--color-earth); }
    .trouble app-pictogram { inline-size: 28px; block-size: 28px; flex: none; }
    .camera { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; }
    .layer { position: fixed; inset: 0; pointer-events: none; z-index: 5; }
    .title { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 4px 0 10px; text-align: center; font: 700 1.4rem var(--font-hand); color: var(--color-earth); }
    .title app-pictogram { inline-size: 36px; block-size: 36px; }
    .hint { margin: -4px 0 10px; text-align: center; font: 700 1rem var(--font-hand); color: var(--color-muted); }
    .drawn { display: flex; justify-content: center; margin: 0 0 8px; }
    .drawn app-pictogram { inline-size: 64px; block-size: 64px; }
    .phrase { margin: 4px 0; text-align: center; font: 700 1.4rem var(--font-hand); color: var(--color-earth); }
    .variance { margin: 8px 0; padding: 8px 10px; border: 2px dashed; font: 700 1.05rem var(--font-hand); text-align: center; }
    .variance.short { border-color: var(--color-alert); color: var(--color-alert); background: var(--color-alert-light); }
    .variance.bonus { border-color: var(--color-pasture); color: var(--color-pasture); background: var(--color-pasture-light); }
    .tiles { display: grid; gap: 10px; }
    .tile {
      position: relative; display: flex; align-items: center; gap: 12px; min-block-size: 64px; padding: 8px 14px; cursor: pointer;
      background: var(--color-shell); border: 3px solid var(--color-card-edge); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard-sm);
      font: 700 1.1rem var(--font-hand); color: var(--color-earth);
    }
    .tile input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
    .tile app-pictogram { inline-size: 40px; block-size: 40px; flex: none; }
    .tile:has(input:checked) { border-color: var(--color-pasture); background: var(--color-pasture-light); }
    .tile:has(input:checked)::after {
      content: '✓'; position: absolute; inset-block-start: -10px; inset-inline-end: -8px; display: grid; place-items: center;
      inline-size: 28px; block-size: 28px; border-radius: var(--radius-blob); background: var(--color-pasture); color: var(--color-on-sign); font-weight: 700;
    }
    .tile:has(input:focus-visible) { outline: var(--focus-ring); outline-offset: 2px; }
    .viewfinder { display: grid; place-items: center; min-block-size: 160px; border: 3px dashed var(--color-card-edge); background: var(--color-shell); }
    .viewfinder.taken { border: 3px solid var(--color-pasture); background: var(--color-pasture-light); }
    .viewfinder app-pictogram { inline-size: 64px; block-size: 64px; opacity: 0.4; }
    .viewfinder img { display: block; inline-size: 100%; max-block-size: 45dvh; object-fit: contain; }
    .actions { display: flex; gap: 12px; margin-block-start: 14px; }
    .actions button {
      min-block-size: 64px; display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer;
      border: 3px solid var(--color-ink); border-radius: var(--radius-wobble-1); box-shadow: var(--shadow-hard); font: 700 1.15rem var(--font-hand);
    }
    .actions button:active { transform: translate(2px, 3px); box-shadow: var(--shadow-hard-xs); }
    .actions button:focus-visible { outline: var(--focus-ring); outline-offset: 2px; }
    .actions app-pictogram { inline-size: 30px; block-size: 30px; }
    .no { flex: 1; background: var(--color-neutral); color: var(--color-on-sign); }
    .yes { flex: 2; background: var(--color-pasture); color: var(--color-on-sign); }
    .actions button:disabled { opacity: 0.6; cursor: not-allowed; }
  `,
})
export class DeliveryCard {
  private readonly sync = inject(JournalSync);
  private readonly voice = inject(Voice);
  private readonly clock = inject(CLOCK);
  private readonly reduce = inject(REDUCE_PHOTO);
  private readonly camera = viewChild.required<ElementRef<HTMLInputElement>>('camera');

  /** What is still to come for the campaign chosen, from the server and the phone. */
  readonly lines = input.required<readonly CaretakerDeliveryLine[]>();
  /** Where the deliveries are written: the site, the campaign and the day chosen in the notebook. */
  readonly target = input.required<DeclarationTarget>();

  protected readonly step = signal<Step>('closed');
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  /** The lines being counted, in order, and where the caretaker is. */
  private readonly queue = signal<readonly CaretakerDeliveryLine[]>([]);
  private readonly at = signal(0);
  protected readonly count = signal(1);
  private readonly done = signal<readonly Counted[]>([]);
  protected readonly paperPreview = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly stamped = signal(false);
  protected readonly trouble = signal<Trouble | null>(null);
  protected readonly troubleWords: Record<Trouble, string> = {
    camera: 'L’appareil photo ne s’ouvre pas. Appuie sur « Pas de papier », et garde le papier pour le chef.',
    full: 'Le téléphone est plein de photos qui attendent le réseau. Va où il y a du réseau, puis recommence.',
    storage: 'Le téléphone n’arrive plus à garder tes déclarations. Appelle le chef.',
  };
  protected readonly unitWords = unitWords;
  protected readonly paper = 'photo' as const;
  private paperBytes: Uint8Array | null = null;
  // The target as it stood when the counting started: what the caretaker saw is where it is written.
  private openedOn: DeclarationTarget | null = null;

  protected readonly current = computed(() => {
    const line = this.queue()[this.at()];
    return line === undefined ? null : { line, counting: deliveryCounting(line.category, line.remaining) };
  });

  /** Fewer than still expected: a shortfall, said with what the chef expected; more: a bonus. */
  protected readonly variance = computed(() => {
    const now = this.current();
    if (now === null) return null;
    const { expected, unit } = now.counting;
    const difference = this.count() - expected;
    if (difference < 0) return { kind: 'short' as const, words: `Il en manque : le chef en attendait ${unitWords(expected, unit)}.` };
    if (difference > 0) return { kind: 'bonus' as const, words: `C’est un bonus : ${unitWords(difference, unit)} de plus que la commande.` };
    return null;
  });

  protected pictoOf(line: CaretakerDeliveryLine): PictogramName {
    return DELIVERED_PICTO[line.category] ?? 'received-bags';
  }

  protected stageOf(line: CaretakerDeliveryLine): string {
    return line.feedStage === null ? '' : STAGE[line.feedStage].css;
  }

  protected unitWord(unit: CountingUnit): string {
    return UNIT_WORDS[unit][0];
  }

  protected leftWords(line: CaretakerDeliveryLine): string {
    const counting = deliveryCounting(line.category, line.remaining);
    return `reste ${unitWords(counting.expected, counting.unit)}`;
  }

  protected start(): void {
    this.openedOn = this.target();
    this.trouble.set(null);
    this.done.set([]);
    const lines = this.lines();
    if (lines.length === 1) {
      this.countLines(lines);
      return;
    }
    this.chosen.set(new Set());
    this.step.set('choose');
    void this.voice.say([clip('delivery-choose')]);
  }

  protected toggle(orderLineId: string): void {
    this.chosen.update((chosen) => {
      const next = new Set(chosen);
      if (!next.delete(orderLineId)) next.add(orderLineId);
      return next;
    });
  }

  protected countChosen(): void {
    this.countLines(this.lines().filter((line) => this.chosen().has(line.orderLineId)));
  }

  protected readBack(): void {
    const now = this.current();
    if (now === null) return;
    this.step.set('confirm');
    const variance = this.variance();
    const said: PhrasePart[] = [clip(RECEIVED[now.counting.unit]), number(this.count())];
    if (variance?.kind === 'short') said.push(clip('delivery-short'), clip('delivery-expected'), number(now.counting.expected));
    if (variance?.kind === 'bonus') said.push(clip('delivery-bonus'));
    void this.voice.say([...said, clip('confirm')]);
  }

  protected backToCount(): void {
    if (this.step() === 'confirm') this.step.set('count');
  }

  protected confirm(): void {
    const now = this.current();
    if (now === null || this.step() !== 'confirm') return;
    this.done.update((done) => [...done, { ...now, count: this.count() }]);
    if (this.at() + 1 < this.queue().length) {
      this.at.update((at) => at + 1);
      this.openCounter();
      return;
    }
    this.step.set('paper');
    void this.voice.say([clip('delivery-paper')]);
  }

  protected shootPaper(): void {
    this.camera().nativeElement.value = '';
    this.camera().nativeElement.click();
  }

  protected async paperTaken(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file === undefined) return;
    try {
      this.paperBytes = await this.reduce(file);
    } catch {
      this.say('camera');
      return;
    }
    this.paperPreview.set(URL.createObjectURL(new Blob([this.paperBytes as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' })));
  }

  protected forgetPaper(): void {
    const url = this.paperPreview();
    if (url !== null) URL.revokeObjectURL(url);
    this.paperPreview.set(null);
    this.paperBytes = null;
  }

  /** One delivery per line counted, all with the same paper: one arrival, one paper (decision of 2026-11-11). */
  protected async write(paper: 'photo' | null): Promise<void> {
    const target = this.openedOn;
    const done = this.done();
    if (this.saving() || target === null || done.length === 0) return;
    this.saving.set(true);
    try {
      const bytes = paper === 'photo' ? this.paperBytes : null;
      const deliveryNote = bytes === null ? ({ kind: 'NoPaper' } as const) : ({ kind: 'Photographed', media: await this.sync.keepMedia(bytes, 'image/jpeg', 'SupportingDocument') } as const);
      for (const { line, counting, count } of done) {
        await this.sync.record({ ...target, recordedAt: this.clock.now().toISOString(), fact: { type: 'Delivery', orderLineId: line.orderLineId, receivedQuantity: receivedOf(count, counting), deliveryNote } });
      }
      this.close();
      this.stamped.set(true);
      void this.voice.say([clip(deliveryNote.kind === 'Photographed' ? 'delivery-paper-saved' : 'written-thanks')]);
      setTimeout(() => this.stamped.set(false), STAMP_MS);
    } catch (error) {
      this.close();
      this.say(error instanceof MediaQueueFull ? 'full' : 'storage');
    } finally {
      this.saving.set(false);
    }
  }

  protected close(): void {
    this.step.set('closed');
    this.queue.set([]);
    this.at.set(0);
    this.done.set([]);
    this.forgetPaper();
  }

  private countLines(lines: readonly CaretakerDeliveryLine[]): void {
    if (lines.length === 0) return;
    this.queue.set(lines);
    this.at.set(0);
    this.openCounter();
  }

  private openCounter(): void {
    const now = this.current();
    if (now === null) return;
    this.count.set(Math.max(1, now.counting.expected));
    this.step.set('count');
    // The feed is named first, so that the bag counted is the right one (N.9)
    const named = now.line.feedStage === null ? [] : [clip(STAGE[now.line.feedStage].clip)];
    void this.voice.say([...named, clip(HOW_MANY[now.counting.unit])]);
  }

  private say(trouble: Trouble): void {
    this.trouble.set(trouble);
    void this.voice.say([clip(trouble === 'camera' ? 'delivery-paper-camera-refused' : trouble === 'full' ? 'photo-phone-full' : 'storage-full')]);
  }
}
