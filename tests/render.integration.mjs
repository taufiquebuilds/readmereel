import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { GIF } from "../skills/readmereel/scripts/lib/gif.mjs";
import { checkProject, ensureBrowser } from "../skills/readmereel/scripts/lib/hf.mjs";
import { LIMITS } from "../skills/readmereel/scripts/lib/story.mjs";
import { main } from "../skills/readmereel/scripts/render.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

function probe(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" }).stdout;
  const data = JSON.parse(out);
  return { ...data.streams[0], duration: Number(data.format.duration) };
}

test("renders both videos and the GIF from a story", () => {
  const repo = tmpDir();
  mkdirSync(join(repo, "docs"));
  spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=0x334155:s=1600x1000", "-frames:v", "1", join(repo, "docs/shot.png")]);
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

test("the longest allowed text fits both layouts", () => {
  const story = validStory();
  story.name = "N".repeat(LIMITS.name);
  story.promise = "Promise ".repeat(8).slice(0, LIMITS.promise);
  story.problem = "Problem ".repeat(9).slice(0, LIMITS.problem);
  story.install = "npx --yes some-long-package-name@1.2.3 init my-new-project --tpl x".slice(0, LIMITS.install);
  story.url = ("github.com/" + "a".repeat(80)).slice(0, LIMITS.url);
  for (const f of story.features) {
    f.title = "Title words ".repeat(4).slice(0, LIMITS.featureTitle);
    f.detail = "Detail words ".repeat(7).slice(0, LIMITS.featureDetail);
  }
  const out = tmpDir();
  const log = join(out, "check.log");
  ensureBrowser({ log });
  for (const layout of ["wide", "tall"]) {
    const dir = buildProject(story, layout, { baseDir: out, outDir: out });
    assert.deepEqual(checkProject(dir, { log }), [], `${layout} layout has problems; see ${log}`);
  }
});

test("a bad story renders nothing and exits 1", () => {
  const repo = tmpDir();
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify({ ...validStory(), name: "" }));
  assert.equal(main([], { cwd: repo }), 1);
});
