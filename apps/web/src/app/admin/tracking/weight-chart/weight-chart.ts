import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { targetAt, type Strain } from '@domain/journal';
import { weightChart, type ChartWeighing } from './weight-chart-geometry';

const grams = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

// The weight of a lot against its strain (V.2; CdC « Le graphe du poids », after bureau-admin.html):
// the strain's target dashed, the validated weighings as joined green points, the latest with its
// average. The geometry is a pure function; this only draws it, as wide as the screen.
@Component({
  selector: 'app-weight-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 320 180" role="img" [attr.aria-label]="label()">
      <path class="axis" d="M28 158 H315 M28 158 V12" />
      @for (kilo of chart().kilos; track kilo.label) {
        <line class="grid" x1="24" x2="315" [attr.y1]="kilo.y" [attr.y2]="kilo.y" />
        <text class="tick" x="18" text-anchor="end" [attr.y]="kilo.y + 4">{{ kilo.label }}</text>
      }
      <text class="tick unit" x="34" y="14">kg</text>
      @for (day of chart().days; track day.label; let last = $last) {
        <!-- The last day ends at the right edge rather than being cut by it. -->
        <text class="tick" y="172" [attr.x]="last ? day.x + 8 : day.x" [attr.text-anchor]="last ? 'end' : 'middle'">{{ day.label }}</text>
      }
      @if (chart().target; as target) {
        <path class="target" [attr.d]="target" />
      }
      @if (chart().real; as real) {
        <path class="real" [attr.d]="real" />
      }
      @for (point of chart().points; track $index) {
        <circle r="5.5" [attr.cx]="point.x" [attr.cy]="point.y" />
      }
      @if (chart().last; as last) {
        <text class="last" [attr.x]="last.anchor === 'start' ? last.x + 8 : last.x - 8" [attr.y]="last.y - 8" [attr.text-anchor]="last.anchor">{{ last.label }}</text>
      }
    </svg>
    <p class="legend" aria-hidden="true">
      @if (strain(); as known) {
        <span><i></i>{{ known.name }} (guide)</span>
      }
      @if (curve().length > 0) {
        &ngsp;<span><b></b>tes pesées validées</span>
      }
    </p>
  `,
  styles: `
    :host { display: block; }
    svg { display: block; inline-size: 100%; block-size: auto; background: var(--color-paper); border: 2px solid var(--color-card-edge); border-radius: 12px; }
    .axis { fill: none; stroke: var(--color-earth); stroke-width: 2.5; stroke-linecap: round; }
    .grid { stroke: var(--color-card-edge); stroke-width: 1; opacity: 0.45; }
    .tick { font: 700 11px var(--font-hand); fill: var(--color-muted); }
    .unit { font-size: 9px; }
    .target { fill: none; stroke: var(--color-earth); stroke-width: 2.5; stroke-dasharray: 6 5; stroke-linecap: round; }
    .real { fill: none; stroke: var(--color-pasture); stroke-width: 3.5; stroke-linecap: round; stroke-linejoin: round; }
    circle { fill: var(--color-pasture); stroke: var(--color-paper); stroke-width: 2; }
    .last { font: 700 12px var(--font-hand); fill: var(--color-pasture); }
    .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 6px 0 0; font-size: 0.8rem; font-weight: 700; color: var(--color-muted); }
    .legend i { display: inline-block; inline-size: 18px; block-size: 0; margin-inline-end: 4px; vertical-align: middle; border-block-start: 3px dashed var(--color-earth); }
    .legend b { display: inline-block; inline-size: 10px; block-size: 10px; margin-inline-end: 4px; vertical-align: middle; border-radius: 50%; background: var(--color-pasture); }
  `,
})
export class WeightChart {
  readonly curve = input.required<readonly ChartWeighing[]>();
  readonly strain = input.required<Strain | null>();

  protected readonly chart = computed(() => weightChart(this.curve(), this.strain()));

  /** What the drawing says, for whoever listens to the screen. */
  protected readonly label = computed(() => {
    const strain = this.strain();
    const latest = this.chart().points.at(-1);
    if (latest === undefined) return strain === null ? 'Courbe de poids : aucune pesée validée.' : `Courbe de poids : aucune pesée validée ; la cible ${strain.name} seule.`;
    const count = this.chart().points.length;
    const target = strain === null ? null : (targetAt(strain, latest.campaignDay)?.weight ?? null);
    return (
      `Courbe de poids : ${count} pesée${count > 1 ? 's' : ''} validée${count > 1 ? 's' : ''}, la dernière à J${latest.campaignDay} : ${grams(latest.average)} g` +
      (target === null || strain === null ? '.' : `, la cible ${strain.name} ce jour-là : ${grams(target)} g.`)
    );
  });
}
