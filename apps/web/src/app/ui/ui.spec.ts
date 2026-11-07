import { Component, signal, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Counter } from './counter';
import { GestureButton } from './gesture-button';
import { Pictogram } from './pictogram';
import { Pile, pileLayout } from './pile';
import { Sheet } from './sheet';
import { Stamp } from './stamp';
import { SyncBadge } from './sync-badge';

// Spec: backlog H.3, H.4, H.5 — les briques du design « cahier » ; journal-gardien.html ;
// CdC « Principes UX » (trois canaux : picto, couleur, audio ; la confiance est visible).

function render<T>(type: Type<T>, inputs: Record<string, unknown> = {}) {
  const fixture = TestBed.createComponent(type);
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  fixture.detectChanges();
  return { fixture, element: fixture.nativeElement as HTMLElement };
}

describe('Pictogramme', () => {
  it("dit son nom à un lecteur d'écran, et pointe sur le picto pré-cuit", () => {
    const { element } = render(Pictogram, { picto: 'dead-chicken' });
    const svg = element.querySelector('svg');

    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('Poulet mort');
    expect(element.querySelector('use')?.getAttribute('href')).toBe('pictograms.svg#dead-chicken');
  });

  it("se tait quand il ne fait que décorer un texte qui dit la même chose", () => {
    const svg = render(Pictogram, { picto: 'open-bag', decorative: true }).element.querySelector('svg');

    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.hasAttribute('aria-label')).toBe(false);
  });
});

describe('Bouton-geste', () => {
  it('affiche le picto, la couleur du geste et son libellé, sur un vrai bouton', () => {
    const { element } = render(GestureButton, { picto: 'dead-chicken', label: 'Morts', tone: 'death' });
    const button = element.querySelector('button');

    expect(button?.type).toBe('button');
    expect(button?.classList).toContain('gesture');
    expect(button?.classList).toContain('tone-death');
    expect(button?.textContent?.trim()).toBe('Morts');
    expect(button?.querySelector('use')?.getAttribute('href')).toBe('pictograms.svg#dead-chicken');
  });
});

describe('Feuille', () => {
  @Component({
    imports: [Sheet],
    template: `<app-sheet title="Combien de morts ?" [open]="open()" (closed)="closes = closes + 1; open.set(false)"><p>dedans</p></app-sheet>`,
  })
  class Host {
    readonly open = signal(true);
    closes = 0;
  }

  it('monte quand elle est ouverte, et se ferme en touchant le voile', () => {
    const { fixture, element } = render(Host);
    expect(element.querySelector('.sheet')?.classList).toContain('on');
    expect(element.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Combien de morts ?');

    (element.querySelector('.veil') as HTMLElement).click();
    fixture.detectChanges();

    expect(fixture.componentInstance.closes).toBe(1);
    expect(element.querySelector('.sheet')?.classList).not.toContain('on');
    expect(element.querySelector('.sheet')?.hasAttribute('inert')).toBe(true);
  });

  it('se ferme aussi avec Échap, seulement quand elle est ouverte', () => {
    const { fixture } = render(Host);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(fixture.componentInstance.closes).toBe(1);
  });
});

describe('Compteur', () => {
  it('augmente et diminue par gros boutons, sans jamais descendre sous un', () => {
    const { fixture, element } = render(Counter, { unit: 'mort' });
    const [minus, plus] = Array.from(element.querySelectorAll('button'));
    const shown = () => element.querySelector('output')?.textContent?.trim();

    expect(shown()).toBe('1');
    expect(minus?.disabled).toBe(true);
    plus?.click();
    plus?.click();
    fixture.detectChanges();
    expect(shown()).toBe('3');
    minus?.click();
    minus?.click();
    minus?.click();
    fixture.detectChanges();
    expect(shown()).toBe('1');
    expect(plus?.getAttribute('aria-label')).toBe('Un mort de plus');
  });
});

describe('Pile', () => {
  it("dessine un objet par unité comptée ; au-delà de douze, elle écrit le reste en « +n »", () => {
    expect(pileLayout('death', 3)).toEqual({ items: ['dead-chicken', 'dead-chicken', 'dead-chicken'], more: 0 });
    expect(pileLayout('bag', 12).items).toHaveLength(12);
    expect(pileLayout('death', 15)).toEqual({ items: Array(12).fill('dead-chicken'), more: 3 });
  });

  it('la pile de réception range par paquets de quatre sacs, cinq paquets par ligne', () => {
    expect(pileLayout('delivery', 40)).toEqual({ items: Array(10).fill('bag-bundle'), more: 0 });
    expect(pileLayout('delivery', 42)).toEqual({ items: [...Array(10).fill('bag-bundle'), 'closed-bag', 'closed-bag'], more: 0 });
    expect(pileLayout('delivery', 70)).toEqual({ items: Array(15).fill('bag-bundle'), more: 10 });
  });

  it('dit sa quantité en mots, et affiche le reste', () => {
    const { element } = render(Pile, { kind: 'death', count: 14, label: '14 morts' });

    expect(element.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('14 morts');
    expect(element.querySelectorAll('app-pictogram')).toHaveLength(12);
    expect(element.querySelector('.more')?.textContent?.trim()).toBe('+2');
  });
});

describe('Tampon', () => {
  it("s'abat sur la page avec « C'est noté ! », annoncé à un lecteur d'écran, puis disparaît", () => {
    const { fixture, element } = render(Stamp, { shown: true });
    expect(element.querySelector('[role="status"]')?.textContent).toContain("C'est noté !");

    fixture.componentRef.setInput('shown', false);
    fixture.detectChanges();
    expect(element.querySelector('.stamp')).toBeNull();
  });
});

describe('Pastille de synchro', () => {
  it("montre le nombre d'envois en attente, et le dit", () => {
    const { element } = render(SyncBadge, { waiting: 3 });

    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('3');
    expect(element.querySelector('.badge')?.classList).not.toContain('sent');
    expect(element.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('3 déclarations attendent le réseau');
  });

  it("passe à « bien envoyé » quand plus rien n'attend — une coche et des mots, pas la couleur seule", () => {
    const { element } = render(SyncBadge, { waiting: 0 });

    expect(element.querySelector('.badge')?.textContent?.trim()).toBe('✓');
    expect(element.querySelector('.badge')?.classList).toContain('sent');
    expect(element.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('Tout est bien envoyé');
  });
});
