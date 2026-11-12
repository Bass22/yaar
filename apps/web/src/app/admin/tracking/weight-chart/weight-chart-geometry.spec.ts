import { STRAINS, targetAt } from '@domain/journal';
import { weightChart } from './weight-chart-geometry';

// Spec: backlog V.2 — la courbe de poids contre la souche ; cahier des charges « Le graphe du poids »
// (d'après bureau-admin.html). Le dessin occupe 320 × 180 : le tracé va de x = 28 à x = 310
// (282 de large) et de y = 158 (zéro) à y = 12 (146 de haut). Les coordonnées attendues sont
// calculées à la main, au dixième.

const COBB = STRAINS[0]!;
const pesee = (campaignDay: number, average: number) => ({ campaignDay, average });

describe('Le graphe du poids, une fonction pure', () => {
  describe('sans pesée validée', () => {
    it('seule la cible de la souche se dessine, jour par jour de J0 à J42 : aucun point, aucune ligne réelle', () => {
      // Given une bande Cobb 500 sans pesée validée
      // When on dessine le graphe
      const chart = weightChart([], COBB);

      // Then la cible part de J0 (41 g) et finit à J42 (2 626 g), sur un axe de 0 à 3 kg :
      // J0 → x = 28, y = 158 − 41 ÷ 3000 × 146 = 156,0 ; J42 → x = 310, y = 158 − 2626 ÷ 3000 × 146 = 30,2
      expect(chart.target?.startsWith('M28.0 156.0 L')).toBe(true);
      expect(chart.target?.endsWith('L310.0 30.2')).toBe(true);
      expect(chart.target?.split(' L')).toHaveLength(43);
      expect(chart.real).toBeNull();
      expect(chart.points).toEqual([]);
      expect(chart.last).toBeNull();
    });

    it('les jours sont gradués chaque semaine, de J7 à J42 ; les kilos à chaque kilo entier, jusqu’au kilo au-dessus de la cible', () => {
      const chart = weightChart([], COBB);

      // 282 ÷ 6 = 47 par semaine ; 1 kg → 158 − 146 ÷ 3 = 109,3 ; 2 kg → 60,7 ; 3 kg → 12,0
      expect(chart.days).toEqual([
        { x: 75, label: 'J7' },
        { x: 122, label: 'J14' },
        { x: 169, label: 'J21' },
        { x: 216, label: 'J28' },
        { x: 263, label: 'J35' },
        { x: 310, label: 'J42' },
      ]);
      expect(chart.kilos).toEqual([
        { y: 109.3, label: '1' },
        { y: 60.7, label: '2' },
        { y: 12, label: '3' },
      ]);
    });
  });

  describe('avec des pesées validées', () => {
    it('une seule pesée : un point, sans ligne, qui porte sa moyenne en grammes', () => {
      // Given une pesée validée à J14 : 600 g
      const chart = weightChart([pesee(14, 600)], COBB);

      // Then x = 28 + 14 ÷ 42 × 282 = 122,0 ; y = 158 − 600 ÷ 3000 × 146 = 128,8
      expect(chart.points).toEqual([{ x: 122, y: 128.8, campaignDay: 14, average: 600 }]);
      expect(chart.real).toBeNull();
      expect(chart.last).toEqual({ x: 122, y: 128.8, anchor: 'start', label: '600 g' });
    });

    it('les pesées se relient dans l’ordre des jours, et la dernière porte sa moyenne', () => {
      // Given trois pesées validées, reçues dans le désordre
      const chart = weightChart([pesee(21, 900), pesee(7, 210), pesee(14, 600)], COBB);

      // Then J7 → (75,0 ; 158 − 210 ÷ 3000 × 146 = 147,8) ; J14 → (122,0 ; 128,8) ; J21 → (169,0 ; 158 − 43,8 = 114,2)
      expect(chart.real).toBe('M75.0 147.8 L122.0 128.8 L169.0 114.2');
      expect(chart.points.map(({ campaignDay }) => campaignDay)).toEqual([7, 14, 21]);
      expect(chart.last?.label).toBe('900 g');
    });

    it('les milliers de la moyenne s’écrivent séparés d’une espace : 1 843 g', () => {
      const chart = weightChart([pesee(28, 1843)], COBB);

      expect(chart.last?.label).toBe('1 843 g');
    });

    it('une pesée au-delà de J42 étend les jours à la semaine entière ; la cible s’arrête au dernier jour de sa table (J49)', () => {
      // Given une pesée validée à J52 : 3 300 g — au-delà de la table Cobb 500
      const chart = weightChart([pesee(52, 3300)], COBB);

      // Then les jours vont jusqu'à J56, les kilos jusqu'à 4 ;
      // la cible finit à J49 : x = 28 + 49 ÷ 56 × 282 = 274,8 ; y = 158 − 3177 ÷ 4000 × 146 = 42,0
      expect(chart.days.at(-1)).toEqual({ x: 310, label: 'J56' });
      expect(chart.kilos.at(-1)).toEqual({ y: 12, label: '4' });
      expect(chart.target?.endsWith('L274.8 42.0')).toBe(true);
      expect(chart.target?.split(' L')).toHaveLength(50);
    });

    it('une pesée plus lourde que la cible monte l’échelle des kilos au kilo au-dessus', () => {
      // Given à J21 une moyenne de 3 150 g (une faute validée quand même) : plus haut que la cible jusqu'à J42 (2 626 g)
      const chart = weightChart([pesee(21, 3150)], COBB);

      // Then l'axe va jusqu'à 4 kg : y = 158 − 3150 ÷ 4000 × 146 = 158 − 114,975 = 43,0
      expect(chart.kilos.map(({ label }) => label)).toEqual(['1', '2', '3', '4']);
      expect(chart.points[0]?.y).toBe(43);
    });

    it('près du bord droit, la moyenne s’écrit à gauche du point pour rester dans le dessin', () => {
      // Given une pesée à J40 : x = 28 + 40 ÷ 42 × 282 = 296,6
      const chart = weightChart([pesee(40, 2400)], COBB);

      expect(chart.last?.anchor).toBe('end');
      expect(chart.last?.x).toBe(296.6);
    });
  });

  it('sans souche connue, pas de cible : les pesées seules, sur l’échelle de leurs poids', () => {
    // Given une souche que l'écran ne connaît pas, et une pesée à J14 : 600 g
    const chart = weightChart([pesee(14, 600)], null);

    // Then pas de cible ; l'axe va jusqu'à 1 kg : y = 158 − 600 ÷ 1000 × 146 = 70,4
    expect(chart.target).toBeNull();
    expect(chart.kilos).toEqual([{ y: 12, label: '1' }]);
    expect(chart.points[0]?.y).toBe(70.4);
  });

  it('la cible suit la table de la souche au jour près', () => {
    // Given la cible Cobb 500 à J21
    const cibleJ21 = targetAt(COBB, 21)!.weight;
    const chart = weightChart([], COBB);

    // Then le 22e point de la cible est à x = 169,0 et à la hauteur de cette cible
    const [x, y] = chart.target!.slice(1).split(' L')[21]!.split(' ').map(Number);
    expect(x).toBe(169);
    expect(y).toBeCloseTo(158 - (cibleJ21 / 3000) * 146, 1);
  });
});
