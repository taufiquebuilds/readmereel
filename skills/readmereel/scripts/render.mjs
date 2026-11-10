#!/usr/bin/env node
import { appendFileSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, LAYOUTS } from "./lib/build.mjs";
import { GIF, makeGif } from "./lib/gif.mjs";
import { checkProject, ensureBrowser, renderProject } from "./lib/hf.mjs";
import { planFilm } from "./lib/plan.mjs";
import { makeContactSheet, makePoster, sceneLabel } from "./lib/sheet.mjs";
import { MUSIC_SKIPPED, musicNotFound, resolveEffects, resolveMusic } from "./lib/sound.mjs";
import { isV1, storyWarnings, toV2, validateStory } from "./lib/story.mjs";
import { checkTools } from "./lib/tools.mjs";

// Everything a run writes next to story.json; deleted before a run renders, so a failed run leaves none of them.
export const OUTPUTS = [LAYOUTS.wide.video, LAYOUTS.tall.video, "video.gif", "poster.png", "contact.png"];
export const MUSIC_HINT = 'No music: add "music": "<an mp3, m4a, wav or ogg file>" to story.json, or "music": "heygen" once the HeyGen CLI is signed in.';

function readStory(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? `No story file at ${path}` : `${path} is not valid JSON: ${err.message}`);
  }
}

// Story file -> both videos, the GIF, the poster and the contact sheet. Steps: tools, story (v1 converts), film plan,
// stale outputs removed, Chrome, sound, both projects built, both checked by the gate (nothing renders unless both
// pass), both rendered, then the GIF, poster and contact sheet. Returns the exit code.
export function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const quality = argv.includes("--draft") ? "draft" : "looks";
  const storyPath = resolve(cwd, argv.find((a) => !a.startsWith("--")) ?? "launch-video/story.json");
  const outDir = dirname(storyPath);
  const show = (p) => relative(cwd, p) || ".";
  const out = (name) => join(outDir, name);
  try {
    const missing = checkTools();
    if (missing.length) {
      missing.forEach((m) => console.error(`✗ ${m}`));
      return 1;
    }
    const raw = readStory(storyPath);
    const errors = validateStory(raw, cwd);
    if (errors.length) {
      console.error(`✗ ${show(storyPath)} has problems:`);
      errors.forEach((e) => console.error(`  - ${e}`));
      return 1;
    }
    const story = toV2(raw, cwd);
    if (isV1(raw)) console.log(`${show(storyPath)} is a v1 story: rendering it as v2 (the file is not changed).`);
    let plan;
    try {
      plan = planFilm(story);
    } catch (err) {
      console.error(`✗ ${err.message}`);
      return 1;
    }

    // Past the tool, story and plan checks, outputs from an earlier run must not survive a failed one.
    for (const name of OUTPUTS) rmSync(out(name), { force: true });
    const log = out("render.log");
    writeFileSync(log, `readmereel: ${plan.scenes.length} scenes, ${plan.duration} s\n`);
    // Notes are printed, written to the log and repeated in the hand-over.
    const notes = [];
    const note = (message) => {
      notes.push(message);
      console.warn(`! ${message}`);
      appendFileSync(log, `! ${message}\n`);
    };
    storyWarnings(story).forEach(note);

    console.log("Getting Chrome ready…");
    ensureBrowser({ log });

    let sfxDir;
    if (story.sfx === false) {
      appendFileSync(log, "Sound effects off (sfx: false).\n");
    } else {
      console.log("Getting sound effects…");
      sfxDir = resolveEffects(out(".sfx"), { log, warn: note });
    }
    const music = resolveMusic(story, out(".music"), { log, baseDir: cwd, warn: note });
    // No music, and no warning already says why: say how to add some.
    const skipped = notes.includes(MUSIC_SKIPPED) || notes.includes(musicNotFound(story.music));
    if (!music && !skipped) {
      notes.push(MUSIC_HINT);
      appendFileSync(log, `${MUSIC_HINT}\n`);
    }

    const dirs = {};
    for (const layout of Object.keys(LAYOUTS)) dirs[layout] = buildProject(story, layout, { baseDir: cwd, outDir, plan, sfxDir, music });
    let failed = false;
    for (const layout of Object.keys(LAYOUTS)) {
      console.log(`Checking the ${layout} video…`);
      const problems = checkProject(dirs[layout], { log, duration: plan.duration });
      if (problems.length) {
        failed = true;
        console.error(`✗ The ${layout} video has problems:`);
        problems.forEach((p) => console.error(`  - ${p}`));
        appendFileSync(log, `Gate (${layout}): ${problems.length} problem(s)\n${problems.map((p) => `  - ${p}\n`).join("")}`);
      }
    }
    if (failed) return 1;

    for (const layout of Object.keys(LAYOUTS)) {
      console.log(`Rendering ${LAYOUTS[layout].video}…`);
      renderProject(dirs[layout], out(LAYOUTS[layout].video), { log, quality });
    }
    const wide = out(LAYOUTS.wide.video);
    const gif = out("video.gif");
    const bytes = makeGif(wide, gif);
    if (bytes > GIF.maxBytes) note(`${show(gif)} is ${(bytes / 1048576).toFixed(1)} MB, over 8 MB even after cutting it to 12 s.`);
    const posterScene = makePoster(wide, plan, out("poster.png"));
    makeContactSheet(wide, out(LAYOUTS.tall.video), plan, out("contact.png"));

    const lines = [
      show(wide),
      show(out(LAYOUTS.tall.video)),
      show(gif),
      `${show(out("poster.png"))} (${sceneLabel(posterScene)})`,
      `${show(out("contact.png"))} (each scene's midpoint, both sizes: look at it before handing over)`,
      show(log),
    ];
    console.log(`✓ Done:\n${lines.map((l) => `  ${l}`).join("\n")}`);
    if (notes.length) console.log(`Notes:\n${notes.map((n) => `  - ${n}`).join("\n")}`);
    appendFileSync(log, `Done.\n${notes.map((n) => `Note: ${n}\n`).join("")}`);
    return 0;
  } catch (err) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
}

// Compare real paths so running through a symlinked skill folder still works.
const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (isMain) process.exit(main());
