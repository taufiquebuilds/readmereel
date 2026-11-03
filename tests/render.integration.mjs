import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { GIF } from "../skills/readmereel/scripts/lib/gif.mjs";
import { checkProject, ensureBrowser } from "../skills/readmereel/scripts/lib/hf.mjs";
import { LIMITS } from "../skills/readmereel/scripts/lib/story.mjs";
import { main } from "../skills/readmereel/scripts/render.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

const RENDER = resolve(dirname(fileURLToPath(import.meta.url)), "../skills/readmereel/scripts/render.mjs");

// A scratch folder that is removed when the test ends. CI keeps them so a failed run's logs can be uploaded.
function scratch(t) {
  const dir = tmpDir();
  t.after(() => {
    if (!process.env.CI) rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makePng(file) {
  mkdirSync(dirname(file), { recursive: true });
  const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x334155:s=1600x1000", "-frames:v", "1", file]);
  assert.equal(made.status, 0, "ffmpeg could not make a test image");
}

function probe(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" }).stdout;
  const data = JSON.parse(out);
  return { ...data.streams[0], duration: Number(data.format.duration) };
}

test("renders both videos and the GIF from a story", (t) => {
  const repo = scratch(t);
  makePng(join(repo, "docs/shot.png"));
  const story = validStory();
  story.features[0].image = "docs/shot.png";
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(story, null, 2));

  assert.equal(main(["--draft"], { cwd: repo }), 0);

  const wide = probe(join(repo, "launch-video/video-16x9.mp4"));
  assert.deepEqual([wide.width, wide.height, wide.r_frame_rate], [1920, 1080, "30/1"]);
  assert.ok(wide.duration >= 24.5 && wide.duration <= 25.5, `wide duration ${wide.duration}`);
  const tall = probe(join(repo, "launch-video/video-9x16.mp4"));
  assert.deepEqual([tall.width, tall.height, tall.r_frame_rate], [1080, 1920, "30/1"]);
  assert.ok(tall.duration >= 24.5 && tall.duration <= 25.5, `tall duration ${tall.duration}`);
  const gif = statSync(join(repo, "launch-video/video.gif")).size;
  assert.ok(gif > 0 && gif <= GIF.maxBytes, `gif size ${gif}`);
});

test("the longest allowed text fits both layouts, beside a real screenshot", (t) => {
  const story = validStory();
  story.name = "N".repeat(LIMITS.name);
  story.promise = "Promise ".repeat(8).slice(0, LIMITS.promise);
  story.problem = "Problem ".repeat(9).slice(0, LIMITS.problem);
  story.install = "npx --yes some-long-package-name@1.2.3 init my-new-project --tpl x".slice(0, LIMITS.install);
  story.url = ("github.com/" + "a".repeat(80)).slice(0, LIMITS.url);
  const out = scratch(t);
  makePng(join(out, "shot.png"));
  for (const f of story.features) {
    f.title = "Title words ".repeat(4).slice(0, LIMITS.featureTitle);
    f.detail = "Detail words ".repeat(7).slice(0, LIMITS.featureDetail);
    f.image = "shot.png";
  }
  const log = join(out, "check.log");
  ensureBrowser({ log });
  for (const layout of ["wide", "tall"]) {
    const dir = buildProject(story, layout, { baseDir: out, outDir: out });
    assert.deepEqual(checkProject(dir, { log }), [], `${layout} layout has problems; see ${log}`);
  }
});

test("the layout check can fail: an overflowing element is reported", (t) => {
  const out = scratch(t);
  const log = join(out, "check.log");
  ensureBrowser({ log });
  const dir = buildProject(validStory(), "wide", { baseDir: out, outDir: out });
  const file = join(dir, "index.html");
  const broken = readFileSync(file, "utf8").replace(
    '<div id="s1-bar"></div>',
    `<div id="s1-bad" style="width:300px;font-size:104px;white-space:nowrap;overflow-wrap:normal">${"W".repeat(400)}</div>`,
  );
  assert.notEqual(broken, readFileSync(file, "utf8"), "the test could not inject the overflowing element");
  writeFileSync(file, broken);
  const problems = checkProject(dir, { log });
  assert.ok(problems.length >= 1, `the overflow was not reported; see ${log}`);
});

test("a bad story renders nothing and says why", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify({ ...validStory(), name: "" }));
  const run = spawnSync("node", [RENDER], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /name: required text/);
  assert.deepEqual(readdirSync(join(repo, "launch-video")), ["story.json"]);
});
