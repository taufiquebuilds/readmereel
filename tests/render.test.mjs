import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { explainProblem } from "../skills/readmereel/scripts/render.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "../skills/readmereel");

test("the script runs when started through a symlinked skill folder", () => {
  const dir = tmpDir();
  symlinkSync(SKILL, join(dir, "linked-skill"));
  const run = spawnSync("node", [join(dir, "linked-skill/scripts/render.mjs"), "missing.json"], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /No story file at /);
});

test("layout problems name the story field behind the element", () => {
  const cases = {
    "#s1-text": "problem",
    "#s2-name": "name",
    "#s2-promise": "promise",
    "#s3 .title": "features[1].title",
    "#s3 .detail": "features[1].detail",
    "#s4 .title": "features[2].title",
    "#s4 .detail": "features[2].detail",
    "#s5 .title": "features[3].title",
    "#s5 .detail": "features[3].detail",
    // HyperFrames names elements without an id by their position, so these are the forms it really prints.
    "#s3 > div:nth-of-type(1) > div:nth-of-type(2)": "features[1].title",
    "#s3 > div:nth-of-type(1) > div:nth-of-type(3)": "features[1].detail",
    "#s4 > div:nth-of-type(1) > div:nth-of-type(2)": "features[2].title",
    "#s4 > div:nth-of-type(1) > div:nth-of-type(3)": "features[2].detail",
    "#s5 > div:nth-of-type(1) > div:nth-of-type(2)": "features[3].title",
    "#s5 > div:nth-of-type(1) > div:nth-of-type(3)": "features[3].detail",
    "#s6-cmd": "install",
    "#s6-line": "install",
    "#s6-url": "url",
  };
  for (const [selector, field] of Object.entries(cases)) {
    assert.equal(explainProblem(`layout: text_overflow: too wide (${selector})`), `layout: text_overflow: too wide (${selector}) -> story field: ${field}`);
  }
});

test("unknown selectors and problems without one print as they are", () => {
  assert.equal(explainProblem("layout: x: m (.mystery)"), "layout: x: m (.mystery)");
  assert.equal(explainProblem("layout: x: m"), "layout: x: m");
});

test("videos from an earlier run are deleted before a new run starts, and a failed run leaves none", () => {
  const repo = tmpDir();
  const bin = join(repo, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), "#!/bin/sh\necho fake npx: $@ >&2\nexit 1\n");
  chmodSync(join(bin, "npx"), 0o755);
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(validStory()));
  const stale = ["video-16x9.mp4", "video-9x16.mp4", "video.gif"].map((n) => join(repo, "launch-video", n));
  stale.forEach((f) => writeFileSync(f, "old"));
  const run = spawnSync("node", [join(SKILL, "scripts/render.mjs")], {
    cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Could not set up Chrome/);
  stale.forEach((f) => assert.equal(existsSync(f), false, `${f} should be gone`));
  assert.match(readFileSync(join(repo, "launch-video/render.log"), "utf8"), /fake npx: --yes hyperframes@0\.9\.9 browser ensure/);
});
