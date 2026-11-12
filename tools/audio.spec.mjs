import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allClipIds, generated, scriptClips } from './audio-script.mjs';
import { recordingId } from './build-audio.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const filesUnder = (dir) =>
  readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(root, path)).isDirectory() ? filesUnder(path) : [path];
  });

// Spec: backlog I.1 à I.3 — le script des phrases, les clips Opus, la voix hors-ligne ;
// CLAUDE.md §4 règle 11 (clips pré-enregistrés ; la synthèse vocale ne sert qu'aux maquettes).
describe('La voix du téléphone', () => {
  it('le script se lit tel quel : identifiants seuls, listes, suites « … -20 » et suites par pas (trente, quarante… quatre-vingt-dix)', () => {
    const { fixed, families } = scriptClips(read('audio/script.md'));

    assert.ok(fixed.includes('confirm') && fixed.includes('sign-in-type-code') && fixed.includes('unit-grams'));
    assert.deepEqual(families['deaths-today'], Array.from({ length: 20 }, (_, rank) => rank + 1));
    assert.deepEqual(families['campaign-day']?.length, 60);
    assert.deepEqual(families['weighing-chicken'], [1, 2, 3, 4, 5]);
    assert.ok([30, 40, 90, 100, 900, 1000, 9000].every((value) => families.number?.includes(value)));
    assert.ok(!families.number?.includes(35) && !families.number?.includes(1500));
  });

  it('le script compte les 464 fichiers par langue qu’il annonce', () => {
    assert.equal(allClipIds(scriptClips(read('audio/script.md'))).length, 464);
    assert.match(read('audio/script.md'), /environ 464 fichiers par langue/);
  });

  it("les identifiants que l'écran peut demander sont ceux du script, à jour : un écran qui demande une phrase absente du script ne compile pas", () => {
    assert.equal(read('apps/web/src/app/core/audio/script-clips.ts'), generated(scriptClips(read('audio/script.md'))), 'relancer node tools/audio-script.mjs');
    execFileSync(process.execPath, ['tools/audio-script.mjs', '--check'], { cwd: root });
  });

  it('chaque langue a la liste de ses clips, qui correspond aux fichiers présents, tous nommés dans le script', () => {
    execFileSync(process.execPath, ['tools/build-audio.mjs', '--check'], { cwd: root });
  });

  it("un enregistrement dont le nom n'est pas dans le script est refusé, avec son nom", () => {
    const known = new Set(['confirm']);

    assert.deepEqual(recordingId('confirm.m4a', known), { id: 'confirm' });
    assert.deepEqual(recordingId('confirme.m4a', known), { refused: "confirme.m4a: « confirme » n'est pas dans audio/script.md" });
  });

  it('les clips se convertissent en Opus mono à 24 kb/s, silences coupés et volume égalisé (décision du 2026-11-07)', () => {
    const tool = read('tools/build-audio.mjs');

    for (const argument of ["'-c:a', 'libopus'", "'-b:a', '24k'", "'-ac', '1'", 'silenceremove', 'loudnorm']) {
      assert.ok(tool.includes(argument), argument);
    }
  });

  it('le service worker garde les clips une fois chargés, pour parler sans réseau', () => {
    const groups = JSON.parse(read('apps/web/ngsw-config.json')).assetGroups;
    const audio = groups.find((group) => group.name === 'audio');

    assert.ok(audio, 'un groupe « audio »');
    assert.deepEqual(audio.resources.files, ['/audio/**']);
    assert.equal(audio.updateMode, 'prefetch', 'un nouvel enregistrement remplace l’ancien à la mise à jour');
  });

  it("l'application ne fait jamais parler la synthèse vocale du navigateur", () => {
    const offenders = filesUnder('apps/web/src').filter((path) => /\.(ts|html)$/.test(path) && /speechSynthesis|SpeechSynthesisUtterance/.test(read(path)));

    assert.deepEqual(offenders, []);
  });
});
