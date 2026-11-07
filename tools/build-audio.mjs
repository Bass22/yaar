// Turns the founder's recordings into the clips the phone plays (backlog I.2, decision of
// 2026-11-07: Opus, mono, 24 kb/s, in WebM). Recordings go in audio/<language>/, one file per
// clip, named by its identifier in audio/script.md, in any common audio format. For each one:
// silences trimmed at both ends, loudness evened, converted — into apps/web/public/audio/<language>/
// with manifest.json, the list of what is recorded and a version that changes with any clip.
//   node tools/build-audio.mjs           convert what changed (needs ffmpeg: brew install ffmpeg)
//   node tools/build-audio.mjs --check   the manifests match the clips and the script (no ffmpeg)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allClipIds, scriptClips, SCRIPT } from './audio-script.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LANGUAGES = ['fr', 'wo'];
export const RECORDINGS = (language) => join(root, 'audio', language);
export const CLIPS = (language) => join(root, 'apps/web/public/audio', language);
const SOURCE_FORMATS = new Set(['.m4a', '.mp3', '.wav', '.ogg', '.opus', '.webm', '.aac', '.flac', '.amr', '.3gp']);

// Trim the silence before and after (the recording guide asks for a second of it), even the
// loudness, then Opus for speech, mono, 24 kb/s.
const FFMPEG_ARGS = (source, target) => [
  '-y', '-loglevel', 'error', '-i', source,
  '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11',
  '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '24k', '-application', 'voip', target,
];

/** The identifier a recording stands for, or why it is refused. */
export function recordingId(fileName, known) {
  const id = basename(fileName, extname(fileName));
  return known.has(id) ? { id } : { refused: `${fileName}: « ${id} » n'est pas dans audio/script.md` };
}

/** The manifest of the clips present: sorted, with a version that changes with any of their bytes. */
export function manifestOf(clipDir) {
  const ids = existsSync(clipDir) ? readdirSync(clipDir).filter((name) => name.endsWith('.webm')).map((name) => basename(name, '.webm')).sort() : [];
  const hash = createHash('sha256');
  for (const id of ids) {
    hash.update(id).update(readFileSync(join(clipDir, `${id}.webm`)));
  }
  return { version: ids.length === 0 ? 'empty' : hash.digest('hex').slice(0, 16), clips: ids };
}

export function checkLanguage(language, known) {
  const problems = [];
  const clipDir = CLIPS(language);
  const manifestPath = join(clipDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return [`${language} : manifest.json manquant`];
  }
  const written = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const actual = manifestOf(clipDir);
  if (JSON.stringify(written) !== JSON.stringify(actual)) {
    problems.push(`${language} : manifest.json ne correspond pas aux clips — relancer node tools/build-audio.mjs`);
  }
  for (const id of actual.clips) {
    if (!known.has(id)) {
      problems.push(`${language} : le clip « ${id} » n'est pas dans audio/script.md`);
    }
  }
  return problems;
}

function build(known) {
  for (const language of LANGUAGES) {
    const recordings = RECORDINGS(language);
    const clipDir = CLIPS(language);
    mkdirSync(clipDir, { recursive: true });
    const files = existsSync(recordings) ? readdirSync(recordings).filter((name) => SOURCE_FORMATS.has(extname(name).toLowerCase())) : [];
    const refused = [];
    for (const file of files) {
      const found = recordingId(file, known);
      if ('refused' in found) {
        refused.push(found.refused);
        continue;
      }
      const source = join(recordings, file);
      const target = join(clipDir, `${found.id}.webm`);
      if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs) {
        execFileSync('ffmpeg', FFMPEG_ARGS(source, target), { stdio: 'inherit' });
      }
    }
    writeFileSync(join(clipDir, 'manifest.json'), `${JSON.stringify(manifestOf(clipDir), null, 2)}\n`);
    const { clips } = manifestOf(clipDir);
    console.log(`${language} : ${clips.length} clips sur ${known.size}`);
    if (refused.length > 0) {
      console.error(refused.join('\n'));
      process.exitCode = 1;
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const known = new Set(allClipIds(scriptClips(readFileSync(SCRIPT, 'utf8'))));
  if (process.argv.includes('--check')) {
    const problems = LANGUAGES.flatMap((language) => checkLanguage(language, known));
    if (problems.length > 0) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
  } else {
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    } catch {
      console.error("ffmpeg est introuvable : l'installer (brew install ffmpeg), puis relancer.");
      process.exit(1);
    }
    build(known);
  }
}
