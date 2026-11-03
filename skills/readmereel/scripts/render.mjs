#!/usr/bin/env node
import { readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, LAYOUTS } from "./lib/build.mjs";
import { GIF, makeGif } from "./lib/gif.mjs";
import { checkProject, ensureBrowser, renderProject } from "./lib/hf.mjs";
import { validateStory } from "./lib/story.mjs";
import { checkTools } from "./lib/tools.mjs";

function readStory(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? `No story file at ${path}` : `${path} is not valid JSON: ${err.message}`);
  }
}

const FIELDS = {
  "#s1-text": "problem",
  "#s2-name": "name",
  "#s2-promise": "promise",
  "#s6-cmd": "install",
  "#s6-line": "install",
  "#s6-url": "url",
};
[["#s3", 1], ["#s4", 2], ["#s5", 3]].forEach(([scene, n]) => {
  FIELDS[`${scene} .title`] = `features[${n}].title`;
  FIELDS[`${scene} .detail`] = `features[${n}].detail`;
  // HyperFrames names an element without an id by its position: the title is the 2nd div in .text, the detail the 3rd.
  FIELDS[`${scene} > div:nth-of-type(1) > div:nth-of-type(2)`] = `features[${n}].title`;
  FIELDS[`${scene} > div:nth-of-type(1) > div:nth-of-type(3)`] = `features[${n}].detail`;
});

// Layout problems end with "(selector)"; say which story field that element shows.
export function explainProblem(problem) {
  const flat = problem.replace(/\s+/g, " ");
  const selector = Object.keys(FIELDS).find((key) => flat.endsWith(` (${key})`));
  return selector ? `${problem} -> story field: ${FIELDS[selector]}` : problem;
}

export function main(argv = process.argv.slice(2), { cwd = process.cwd() } = {}) {
  const quality = argv.includes("--draft") ? "draft" : "looks";
  const storyPath = resolve(cwd, argv.find((a) => !a.startsWith("--")) ?? "launch-video/story.json");
  const outDir = dirname(storyPath);
  const show = (p) => relative(cwd, p) || ".";
  try {
    const missing = checkTools();
    if (missing.length) {
      missing.forEach((m) => console.error(`✗ ${m}`));
      return 1;
    }
    const story = readStory(storyPath);
    const errors = validateStory(story, cwd);
    if (errors.length) {
      console.error(`✗ ${show(storyPath)} has problems:`);
      errors.forEach((e) => console.error(`  - ${e}`));
      return 1;
    }
    // Outputs from an earlier run must not survive a failed one.
    for (const name of [LAYOUTS.wide.video, LAYOUTS.tall.video, "video.gif"]) rmSync(join(outDir, name), { force: true });
    const log = join(outDir, "render.log");
    writeFileSync(log, "");
    console.log("Getting Chrome ready…");
    ensureBrowser({ log });
    const dirs = {};
    let failed = false;
    for (const layout of Object.keys(LAYOUTS)) {
      dirs[layout] = buildProject(story, layout, { baseDir: cwd, outDir });
      const problems = checkProject(dirs[layout], { log });
      if (problems.length) {
        failed = true;
        console.error(`✗ The ${layout} video has layout problems:`);
        problems.forEach((p) => console.error(`  - ${explainProblem(p)}`));
      }
    }
    if (failed) return 1;
    for (const layout of Object.keys(LAYOUTS)) {
      console.log(`Rendering ${LAYOUTS[layout].video}…`);
      renderProject(dirs[layout], join(outDir, LAYOUTS[layout].video), { log, quality });
    }
    const gif = join(outDir, "video.gif");
    const bytes = makeGif(join(outDir, LAYOUTS.wide.video), gif);
    if (bytes > GIF.maxBytes) console.warn(`! ${show(gif)} is ${(bytes / 1048576).toFixed(1)} MB, over 8 MB even after cutting it to 12 s.`);
    console.log(`✓ Done:\n  ${show(join(outDir, LAYOUTS.wide.video))}\n  ${show(join(outDir, LAYOUTS.tall.video))}\n  ${show(gif)}`);
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
