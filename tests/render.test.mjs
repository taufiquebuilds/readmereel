import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OUTPUTS } from "../skills/readmereel/scripts/render.mjs";
import { tmpDir, validStory, validStory2 } from "./helpers.mjs";

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), "../skills/readmereel");

test("the script runs when started through a symlinked skill folder", () => {
  const dir = tmpDir();
  symlinkSync(SKILL, join(dir, "linked-skill"));
  const run = spawnSync("node", [join(dir, "linked-skill/scripts/render.mjs"), "missing.json"], { cwd: dir, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /No story file at /);
});

test("outputs from an earlier run are deleted before a new run starts, and a failed run leaves none", () => {
  const repo = tmpDir();
  const bin = join(repo, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "npx"), "#!/bin/sh\necho fake npx: $@ >&2\nexit 1\n");
  chmodSync(join(bin, "npx"), 0o755);
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(validStory()));
  assert.deepEqual(OUTPUTS, ["video-16x9.mp4", "video-9x16.mp4", "video.gif", "poster.png", "contact.png"]);
  const stale = OUTPUTS.map((n) => join(repo, "launch-video", n));
  stale.forEach((f) => writeFileSync(f, "old"));
  const run = spawnSync("node", [join(SKILL, "scripts/render.mjs")], {
    cwd: repo, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Could not set up Chrome/);
  stale.forEach((f) => assert.equal(existsSync(f), false, `${f} should be gone`));
  assert.match(readFileSync(join(repo, "launch-video/render.log"), "utf8"), /fake npx: --yes hyperframes@0\.9\.9 browser ensure/);
});

test("a plan error is printed as the planner wrote it, and nothing is deleted", () => {
  const repo = tmpDir();
  mkdirSync(join(repo, "launch-video"));
  const story = validStory2();
  const long = "word ".repeat(9).trim().slice(0, 60);
  story.scenes = [
    { type: "hook", lines: ["one two three four", "one two three four", "one two three four"] },
    { type: "title", promise: long },
    { type: "terminal", command: "x".repeat(48), output: Array(12).fill("a b c d e f g h i j k l m n"), highlight: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { type: "list", items: ["a b c d e f g", "a b c d e f g", "a b c d e f g"] },
    { type: "list", items: ["a b c d e f g", "a b c d e f g", "a b c d e f g"] },
    { type: "counter", items: [1, 2, 3].map((v) => ({ value: v, label: "one two three four", note: "one two three four five" })) },
    { type: "end" },
  ];
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(story));
  writeFileSync(join(repo, "launch-video/poster.png"), "old");
  const run = spawnSync("node", [join(SKILL, "scripts/render.mjs")], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /^✗ Too much to read in 35 s: remove a scene or shorten text in scenes\[\d\] \(\w+\)\n$/);
  assert.equal(existsSync(join(repo, "launch-video/poster.png")), true);
});
