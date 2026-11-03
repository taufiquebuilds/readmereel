#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
    const log = join(outDir, "render.log");
    writeFileSync(log, "");
    console.log("Getting Chrome ready…");
    ensureBrowser({ log });
    for (const layout of Object.keys(LAYOUTS)) {
      const dir = buildProject(story, layout, { baseDir: cwd, outDir });
      const problems = checkProject(dir, { log });
      if (problems.length) {
        console.error(`✗ The ${layout} video has layout problems:`);
        problems.forEach((p) => console.error(`  - ${p}`));
        return 1;
      }
      console.log(`Rendering ${LAYOUTS[layout].video}…`);
      renderProject(dir, join(outDir, LAYOUTS[layout].video), { log, quality });
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(main());
}
