import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, join, resolve } from "node:path";
import { runHf } from "./hf.mjs";
import { musicTag } from "./music-tag.mjs";

export { musicTag };

export const SOUNDS = ["whoosh", "whoosh-short", "pop", "click-soft", "key-press", "impact-bass-1"];
export const MUSIC_FEEL = "confident minimal pulse, 110–124 bpm, builds to a bright end";
export const MUSIC_SKIPPED = "Music skipped: sign in to HeyGen (heygen auth login --oauth) or give a music file.";

const CREDITS = `# Sound effects

The effects in this folder come from HyperFrames' bundled sound library (media-use, source "bundled") and are used under the Pixabay Content Licence.
They are resolved when the film is built and are not part of the readmereel repository.
`;

// media-use prints notes on stderr and one JSON object on stdout; take the last line that parses.
export function parseResolve(stdout) {
  const lines = String(stdout ?? "").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (const line of lines.reverse()) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  return undefined;
}

// Run one `media-use resolve`; returns the absolute file it produced, or { error }.
function resolveOne(args, projectDir, { log, run }) {
  const result = runHf(["media-use", "resolve", ...args, "--project", projectDir, "--json"], { log, run, timeout: 5 * 60_000 });
  const json = parseResolve(result.stdout);
  if (result.error) return { error: result.error.message };
  if (!json || json.ok !== true || typeof json.path !== "string") {
    const detail = typeof json?.error === "string" ? json.error : json?.error?.message;
    return { error: detail ?? `exit ${result.status}` };
  }
  const file = isAbsolute(json.path) ? json.path : resolve(projectDir, json.path);
  return existsSync(file) ? { file } : { error: `${json.path} was not written` };
}

// Resolves HyperFrames' bundled effects (no network, nothing copied into the repo) and returns the folder holding
// <sound>.mp3 for each one that resolved. Sounds that fail are skipped with a warning.
export function resolveEffects(projectDir, { log, run, warn = console.warn } = {}) {
  const sfxDir = join(projectDir, "sfx");
  mkdirSync(sfxDir, { recursive: true });
  let any = false;
  for (const sound of SOUNDS) {
    const r = resolveOne(["--type", "sfx", "--intent", sound, "--local-only"], projectDir, { log, run });
    if (r.error) {
      warn(`Sound effect "${sound}" skipped: ${r.error}`);
      continue;
    }
    copyFileSync(r.file, join(sfxDir, `${sound}.mp3`));
    any = true;
  }
  if (any) writeFileSync(join(sfxDir, "CREDITS.md"), CREDITS);
  return sfxDir;
}

// Returns the absolute path of the music file to use, or null.
export function resolveMusic(story, projectDir, { log, run, baseDir = process.cwd(), warn = console.warn } = {}) {
  const music = story.music ?? null;
  if (music === null) return null;
  if (music !== "heygen") {
    const src = resolve(baseDir, music);
    if (!existsSync(src)) {
      warn(`Music skipped: ${music} not found.`);
      return null;
    }
    mkdirSync(projectDir, { recursive: true });
    const dest = join(projectDir, `music${extname(src).toLowerCase()}`);
    copyFileSync(src, dest);
    return dest;
  }
  const r = resolveOne(["--type", "bgm", "--intent", MUSIC_FEEL], projectDir, { log, run });
  if (r.error) {
    warn(MUSIC_SKIPPED);
    return null;
  }
  return r.file;
}
