import { Subject } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { busyIn, watchForUpdates, type UpdatePage } from './app-update';

// Spec: backlog Z.5 — une nouvelle version s'installe sans rien demander au gardien (décision du
// 2026-11-08, réserve 6 de la vérification du lot K) : relance silencieuse quand l'application
// n'est pas utilisée — à l'ouverture, ou au retour au premier plan —, jamais en plein geste, sans
// heure fixe, sans message. À l'ouverture, le service worker d'Angular sert déjà la nouvelle version.

const page = (state: { visible: boolean; busy: boolean }) => {
  const listeners: (() => void)[] = [];
  let reloads = 0;
  const fake: UpdatePage = {
    visible: () => state.visible,
    busy: () => state.busy,
    onVisibilityChange: (listener) => listeners.push(listener),
    reload: () => (reloads += 1),
  };
  return {
    fake,
    show: () => ((state.visible = true), listeners.forEach((listener) => listener())),
    hide: () => ((state.visible = false), listeners.forEach((listener) => listener())),
    reloads: () => reloads,
    state,
  };
};
const updates = () => {
  const versionUpdates = new Subject<{ type: string }>();
  let checks = 0;
  return { versionUpdates, checkForUpdate: async () => ((checks += 1), true), checks: () => checks };
};

describe('La mise à jour silencieuse', () => {
  it('une version prête pendant que l’application est cachée : elle se relance aussitôt', () => {
    const p = page({ visible: false, busy: false });
    const u = updates();
    watchForUpdates(u, p.fake);

    u.versionUpdates.next({ type: 'VERSION_READY' });
    expect(p.reloads()).toBe(1);
  });

  it('une version prête pendant que le gardien s’en sert : rien, puis la relance au retour au premier plan', () => {
    const p = page({ visible: true, busy: false });
    const u = updates();
    watchForUpdates(u, p.fake);

    u.versionUpdates.next({ type: 'VERSION_READY' });
    expect(p.reloads()).toBe(0);
    p.hide();
    expect(p.reloads()).toBe(1);
  });

  it('jamais en plein geste : cachée avec une feuille ouverte, elle attend ; le geste fini, elle se relance au retour', () => {
    const p = page({ visible: true, busy: true });
    const u = updates();
    watchForUpdates(u, p.fake);

    u.versionUpdates.next({ type: 'VERSION_READY' });
    p.hide();
    p.show();
    expect(p.reloads()).toBe(0);

    p.state.busy = false;
    p.hide();
    expect(p.reloads()).toBe(1);
  });

  it('au retour au premier plan, elle demande s’il existe une nouvelle version', () => {
    const p = page({ visible: false, busy: false });
    const u = updates();
    watchForUpdates(u, p.fake);

    p.show();
    expect(u.checks()).toBe(1);
  });

  it('sans version prête, rien ne se relance', () => {
    const p = page({ visible: true, busy: false });
    const u = updates();
    watchForUpdates(u, p.fake);

    p.hide();
    p.show();
    u.versionUpdates.next({ type: 'VERSION_DETECTED' });
    p.hide();
    expect(p.reloads()).toBe(0);
  });

  describe('un geste en cours', () => {
    it('une feuille ouverte (le compteur, la relecture, la photo) est un geste en cours', () => {
      document.body.innerHTML = '<section class="sheet on"></section>';
      expect(busyIn(document)).toBe(true);
      document.body.innerHTML = '<section class="sheet"></section>';
      expect(busyIn(document)).toBe(false);
    });

    it('le curseur dans une case de saisie aussi (un montant tapé au bureau) ; sur un bouton, non', () => {
      document.body.innerHTML = '<input id="amount" /><textarea id="note"></textarea><button id="ok">Oui</button>';
      document.getElementById('amount')?.focus();
      expect(busyIn(document)).toBe(true);
      document.getElementById('note')?.focus();
      expect(busyIn(document)).toBe(true);
      document.getElementById('ok')?.focus();
      expect(busyIn(document)).toBe(false);
    });
  });
});
