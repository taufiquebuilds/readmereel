// Render integration tests: they run HyperFrames for real (Chrome, check, render) and take minutes. `npm run test:render`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { GIF } from "../skills/readmereel/scripts/lib/gif.mjs";
import { checkProject, ensureBrowser } from "../skills/readmereel/scripts/lib/hf.mjs";
import { planFilm } from "../skills/readmereel/scripts/lib/plan.mjs";
import { framesOf, midFrame, POSTER_WIDTH, posterScene, sheetLayout, TILE } from "../skills/readmereel/scripts/lib/sheet.mjs";
import { MUSIC_SKIPPED } from "../skills/readmereel/scripts/lib/sound.mjs";
import { LIMITS, validateStory } from "../skills/readmereel/scripts/lib/story.mjs";
import { MUSIC_HINT } from "../skills/readmereel/scripts/render.mjs";
import { tmpDir, validStory2 } from "./helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL = resolve(HERE, "../skills/readmereel");
const RENDER = join(SKILL, "scripts/render.mjs");
const FIXTURE = join(HERE, "fixtures/all-scenes");
const MINUTE = 60_000;

// A scratch folder removed when the test ends (kept on CI, or with KEEP_RENDERS=1, so a failed run can be looked at).
function scratch(t) {
  const dir = tmpDir();
  t.after(() => {
    if (!process.env.CI && !process.env.KEEP_RENDERS) rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

function makeImage(file, source) {
  mkdirSync(dirname(file), { recursive: true });
  const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `${source}=s=1600x1000`, "-frames:v", "1", file]);
  assert.equal(made.status, 0, `ffmpeg could not make ${file}`);
}

// A repo holding the all-scenes fixture: launch-video/{story.json, logo.svg, screens/dashboard.html} and docs/*.png.
function allScenesRepo(t) {
  const repo = scratch(t);
  mkdirSync(join(repo, "launch-video/screens"), { recursive: true });
  copyFileSync(join(FIXTURE, "story.json"), join(repo, "launch-video/story.json"));
  copyFileSync(join(FIXTURE, "logo.svg"), join(repo, "launch-video/logo.svg"));
  copyFileSync(join(FIXTURE, "screens/dashboard.html"), join(repo, "launch-video/screens/dashboard.html"));
  makeImage(join(repo, "docs/before.png"), "testsrc2");
  makeImage(join(repo, "docs/after.png"), "smptehdbars");
  return repo;
}

function render(repo, args = ["--draft"]) {
  const run = spawnSync("node", [RENDER, ...args], { cwd: repo, encoding: "utf8", timeout: 40 * MINUTE, maxBuffer: 64 * 1024 * 1024 });
  return { ...run, output: `${run.stdout}\n${run.stderr}` };
}

function probe(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height,r_frame_rate:format=duration", "-of", "json", file], { encoding: "utf8" }).stdout;
  const data = JSON.parse(out);
  const video = data.streams.find((s) => s.codec_type === "video");
  return { ...video, audio: data.streams.some((s) => s.codec_type === "audio"), duration: Number(data.format.duration) };
}

// An image file decoded to RGB at its own size.
function decode(file, width, height) {
  const out = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 256 * 1024 * 1024 });
  assert.equal(out.stdout.length, width * height * 3, `${file} is not ${width}x${height}`);
  return { width, height, data: out.stdout };
}

// Mean absolute difference between a region of `img` at (x, y) and `ref` (same size as the region), per channel.
function diff(img, x, y, ref, fromRow = 0) {
  let sum = 0, n = 0;
  for (let r = fromRow; r < ref.height; r++) {
    const a = ((y + r) * img.width + x) * 3, b = r * ref.width * 3;
    for (let i = 0; i < ref.width * 3; i++) { sum += Math.abs(img.data[a + i] - ref.data[b + i]); n++; }
  }
  return sum / n;
}

// ---------- frame metrics (the tools Tasks 5-7 used, in JS) ----------
// Per frame at 384 px wide: ink = the share of pixels that differ by more than 40 from the frame's dominant colour (a
// 32-level colour histogram); luma range (max - min). A frame whose luma range is under 24 is blank (only ground);
// near-empty = ink under 1.5% in a frame that is not blank. Boundary ink is the ink 0.15 s into each scene.
function frameRows(video) {
  return new Promise((done, fail) => {
    const p = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", video], { encoding: "utf8" });
    const [W0, H0] = p.stdout.trim().split(",").map(Number);
    const w = 384, h = Math.round((H0 * w) / W0 / 2) * 2;
    const ff = spawn("ffmpeg", ["-v", "error", "-i", video, "-vf", `scale=${w}:${h}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const size = w * h * 3;
    const rows = [];
    let buf = Buffer.alloc(0);
    const counts = new Uint32Array(32768);
    const frame = (f) => {
      counts.fill(0);
      let ymin = 255, ymax = 0;
      for (let i = 0; i < size; i += 3) {
        counts[((f[i] >> 3) << 10) | ((f[i + 1] >> 3) << 5) | (f[i + 2] >> 3)]++;
        const y = 0.299 * f[i] + 0.587 * f[i + 1] + 0.114 * f[i + 2];
        if (y < ymin) ymin = y;
        if (y > ymax) ymax = y;
      }
      let mode = 0;
      for (let k = 1; k < counts.length; k++) if (counts[k] > counts[mode]) mode = k;
      const bg = [(mode >> 10) * 8 + 4, ((mode >> 5) & 31) * 8 + 4, (mode & 31) * 8 + 4];
      let ink = 0;
      for (let i = 0; i < size; i += 3) {
        if (Math.max(Math.abs(f[i] - bg[0]), Math.abs(f[i + 1] - bg[1]), Math.abs(f[i + 2] - bg[2])) > 40) ink++;
      }
      rows.push({ t: rows.length / 30, ink: (100 * ink) / (w * h), range: ymax - ymin });
    };
    ff.stdout.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= size) { frame(buf.subarray(0, size)); buf = buf.subarray(size); }
    });
    ff.on("error", fail);
    ff.on("close", (code) => (code === 0 ? done(rows) : fail(new Error(`ffmpeg exit ${code}`))));
  });
}

function metrics(rows, plan) {
  const blank = rows.filter((r) => r.range < 24);
  const near = rows.filter((r) => r.range >= 24 && r.ink < 1.5);
  const boundaries = plan.scenes.slice(1).map((s) => {
    const r = rows.find((x) => x.t >= s.start + 0.15 - 1e-6);
    return { scene: `${s.id} ${s.type}`, in: s.in, ink: Number(r.ink.toFixed(1)), flood: r.range < 24 };
  });
  return { frames: rows.length, blank: blank.map((r) => r.t.toFixed(3)), nearEmpty: near.map((r) => r.t.toFixed(3)), boundaries };
}

// ---------- the all-scenes film ----------

test("the all-scenes film renders in both sizes, with its GIF, poster, contact sheet and frame metrics", { timeout: 45 * MINUTE }, async (t) => {
  const repo = allScenesRepo(t);
  const out = (name) => join(repo, "launch-video", name);
  const story = JSON.parse(readFileSync(out("story.json"), "utf8"));
  assert.deepEqual(validateStory(story, repo), []);
  assert.deepEqual([...new Set(story.scenes.map((s) => s.type))].sort(), ["compare", "counter", "end", "hook", "list", "terminal", "title", "ui"]);
  const plan = planFilm(story);

  const run = render(repo);
  assert.equal(run.status, 0, run.output);
  t.diagnostic(run.stdout.trim());

  for (const [name, w, h] of [["video-16x9.mp4", 1920, 1080], ["video-9x16.mp4", 1080, 1920]]) {
    const v = probe(out(name));
    assert.deepEqual([v.width, v.height, v.r_frame_rate], [w, h, "30/1"], name);
    assert.ok(Math.abs(v.duration - plan.duration) <= 0.1, `${name} lasts ${v.duration} s, the plan ${plan.duration} s`);
    assert.ok(v.audio, `${name} has the sound effects`);
  }
  const gif = statSync(out("video.gif")).size;
  assert.ok(gif > 0 && gif <= GIF.maxBytes, `gif size ${gif}`);

  // The poster is the title's midpoint frame, 960 px wide.
  const poster = decode(out("poster.png"), POSTER_WIDTH, 540);
  const [titleMid] = framesOf(out("video-16x9.mp4"), [midFrame(posterScene(plan))], POSTER_WIDTH, 540);
  assert.equal(posterScene(plan).type, "title");
  assert.ok(diff(poster, 0, 0, titleMid) < 1, "poster.png is the title's midpoint frame");

  // Each contact sheet tile is that scene's midpoint frame (compared below the label).
  const layout = sheetLayout(plan.scenes.length);
  const sheet = decode(out("contact.png"), layout.width, layout.height);
  const numbers = plan.scenes.map(midFrame);
  const wide = framesOf(out("video-16x9.mp4"), numbers, TILE.width, TILE.height);
  const tall = framesOf(out("video-9x16.mp4"), numbers, TILE.tallWidth, TILE.height);
  plan.scenes.forEach((s, k) => {
    const at = layout.tiles[k];
    assert.ok(diff(sheet, at.wide.x, at.wide.y, wide[k], 60) < 1, `wide tile ${k + 1} is ${s.id}'s midpoint`);
    assert.ok(diff(sheet, at.tall.x, at.tall.y, tall[k], 60) < 1, `tall tile ${k + 1} is ${s.id}'s midpoint`);
    // and not the neighbouring scene's
    if (k > 0) assert.ok(diff(sheet, at.wide.x, at.wide.y, wide[k - 1], 60) > 3, `wide tile ${k + 1} differs from ${plan.scenes[k - 1].id}`);
  });

  // No music given: the hand-over and the log say how to add it.
  assert.ok(run.stdout.includes(MUSIC_HINT), "the hand-over says how to add music");
  assert.ok(readFileSync(out("render.log"), "utf8").includes(MUSIC_HINT));

  // Frame metrics: no blank frames outside flood transitions, almost no near-empty frames, and every scene has ink
  // 0.15 s after it starts (floods excepted).
  for (const name of ["video-16x9.mp4", "video-9x16.mp4"]) {
    const m = metrics(await frameRows(out(name)), plan);
    t.diagnostic(`${name}: ${JSON.stringify(m)}`);
    assert.equal(m.frames, Math.round(plan.duration * 30), `${name} frame count`);
    assert.ok(m.nearEmpty.length <= 3, `${name}: near-empty frames at ${m.nearEmpty.join(", ")}`);
    assert.ok(m.blank.length <= 4, `${name}: blank frames at ${m.blank.join(", ")}`);
    // Tasks 5-7 aimed at 3% and flagged anything lower for a look; under 2% a scene opens on a nearly empty frame.
    for (const b of m.boundaries) if (!b.flood) assert.ok(b.ink >= 2, `${name}: ${b.scene} (in by ${b.in}) has ${b.ink}% ink at +0.15 s`);
  }
});

test("sfx: false renders silent, and a music fallback is reported in the log and the hand-over", { timeout: 30 * MINUTE }, (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "launch-video"));
  const story = { ...validStory2(), sfx: false, music: "heygen" };
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(story, null, 2));
  // Without a signed-in HeyGen CLI the catalog cannot be reached; with one, this case cannot show the fallback.
  const heygen = spawnSync("heygen", ["--version"], { encoding: "utf8" });
  if (heygen.status === 0) t.skip("the HeyGen CLI is installed here: the music fallback cannot be forced");
  const run = render(repo);
  assert.equal(run.status, 0, run.output);
  for (const name of ["video-16x9.mp4", "video-9x16.mp4"]) assert.equal(probe(join(repo, "launch-video", name)).audio, false, `${name} has no audio`);
  assert.ok(run.stderr.includes(`! ${MUSIC_SKIPPED}`), "printed when it happens");
  assert.ok(run.stdout.includes(`Notes:\n  - ${MUSIC_SKIPPED}`), "repeated in the hand-over");
  const log = readFileSync(join(repo, "launch-video/render.log"), "utf8");
  assert.ok(log.includes(`! ${MUSIC_SKIPPED}`) && log.includes(`Note: ${MUSIC_SKIPPED}`), "in the render log");
  assert.ok(log.includes("Sound effects off (sfx: false)."));
  assert.ok(!log.includes("--type sfx"), "no effect was resolved");
});

// ---------- the gate ----------

// Text exactly `n` characters long, words of mixed widths, never ending in a space.
const text = (n, seed = "Maximum widths wanted here and there ") => {
  const s = seed.repeat(Math.ceil(n / seed.length) + 1).slice(0, n);
  return s.endsWith(" ") ? `${s.slice(0, -1)}W` : s;
};
const hookLine = () => "Maximum Widths Wanted!".slice(0, LIMITS.hookLine);

// Three stories that together put every scene type with every field at its limit through the gate.
function longestStories(dir) {
  makeImage(join(dir, "shot.png"), "testsrc2");
  makeImage(join(dir, "before.png"), "testsrc2");
  makeImage(join(dir, "after.png"), "smptehdbars");
  mkdirSync(join(dir, "screens"));
  copyFileSync(join(FIXTURE, "screens/dashboard.html"), join(dir, "screens/dashboard.html"));
  const top = {
    version: 2,
    name: text(LIMITS.name, "Wordmark Wide "),
    url: `github.com/${"a".repeat(LIMITS.url - 18)}/repo`.slice(0, LIMITS.url),
    install: text(LIMITS.install, "npx --yes some-long-package@1.2.3 init "),
    accent: "#0f766e",
  };
  const hook = { type: "hook", lines: [hookLine(), hookLine(), "9999999 Maximum Width"], count: { line: 2, to: 9999999 } };
  const label = text(LIMITS.label, "Monthly report sent ");
  const counter = { type: "counter", items: [0, 1, 2].map((k) => ({ value: k === 1 ? 999999.9 : 9999999, label: text(LIMITS.counterLabel, "Sessions per month "), suffix: "ms%".slice(0, LIMITS.suffix), note: text(LIMITS.note, "up from last month ") })) };
  // Eight states, each on its own element as a real screen would act: four rows go live, then four nav items light up.
  const states = Array.from({ length: 8 }, (_, k) => (k < 4
    ? { at: 1 + 0.4 * k, selector: `tbody tr:nth-of-type(${k + 1}) .status`, set: "live" }
    : { at: 1 + 0.4 * k, selector: `.top span:nth-of-type(${((k - 4) % 3) + 1})`, set: "on" }));
  const point = () => text(LIMITS.point, "Every point at its longest allowed ");
  return {
    images: { ...top, scenes: [hook, { type: "title", promise: text(LIMITS.promise) },
      { type: "ui", image: "shot.png", focus: [0, 1, 2].map((k) => ({ box: [100 + 400 * k, 100, 400, 300], label })), caption: text(LIMITS.caption, "Sent all by itself ") },
      counter, { type: "end" }] },
    text: { ...top, scenes: [hook,
      { type: "terminal", command: text(LIMITS.command, "repoheat dashboard --user someone "), output: Array.from({ length: 12 }, (_, k) => text(LIMITS.outputLine, `${k} line of real output text `)), highlight: [11] },
      { type: "list", items: [0, 1, 2].map(() => text(LIMITS.listItem, "Branded report every month ")) },
      counter, { type: "end" }] },
    screens: { ...top, scenes: [{ type: "hook", lines: [hookLine()] },
      { type: "ui", html: "screens/dashboard.html", focus: [0, 1, 2].map((k) => ({ box: [36, 120 + 200 * k, 1388, 200], label })), states, caption: text(LIMITS.caption, "Sent all by itself ") },
      { type: "compare", before: { label: text(LIMITS.sideLabel, "Without the tool here "), points: [point(), point(), point()] }, after: { label: text(LIMITS.sideLabel, "With the tool right here "), points: [point(), point(), point()] } },
      { type: "compare", before: { label: text(LIMITS.sideLabel, "Without the tool here "), image: "before.png" }, after: { label: text(LIMITS.sideLabel, "With the tool right here "), image: "after.png" } },
      { type: "end" }] },
  };
}

test("the longest allowed text in every scene type passes the gate in both layouts", { timeout: 30 * MINUTE }, (t) => {
  const dir = scratch(t);
  const log = join(dir, "check.log");
  ensureBrowser({ log });
  for (const [name, story] of Object.entries(longestStories(dir))) {
    assert.deepEqual(validateStory(story, dir), [], `${name} is a valid story at the limits`);
    const plan = planFilm(story);
    for (const layout of ["wide", "tall"]) {
      const project = buildProject(story, layout, { baseDir: dir, outDir: join(dir, name), plan });
      assert.deepEqual(checkProject(project, { log, duration: plan.duration }), [], `${name} ${layout} has problems; see ${log}`);
    }
  }
});

test("the gate catches an overflowing element (negative control)", { timeout: 15 * MINUTE }, (t) => {
  const dir = scratch(t);
  const log = join(dir, "check.log");
  ensureBrowser({ log });
  const story = validStory2();
  const plan = planFilm(story);
  const project = buildProject(story, "wide", { baseDir: dir, outDir: dir, plan });
  const file = join(project, "compositions/s1-hook.html");
  const html = readFileSync(file, "utf8");
  const broken = html.replace('data-style="midnight">', `data-style="midnight">
  <div id="neg-bad" style="position:absolute;left:100px;top:100px;width:300px;font-size:104px;white-space:nowrap;overflow-wrap:normal">${"W".repeat(400)}</div>`);
  assert.notEqual(broken, html, "the test could not inject the overflowing element");
  writeFileSync(file, broken);
  const problems = checkProject(project, { log, duration: plan.duration });
  assert.ok(problems.some((p) => p.includes("#neg-bad")), `the overflow of #neg-bad was not reported (got ${JSON.stringify(problems)}); see ${log}`);
});

// ---------- failures ----------

test("a bad story renders nothing and says why", (t) => {
  const repo = scratch(t);
  mkdirSync(join(repo, "launch-video"));
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify({ ...validStory2(), name: "" }));
  const run = spawnSync("node", [RENDER], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /name: required text/);
  assert.deepEqual(readdirSync(join(repo, "launch-video")), ["story.json"]);
});

test("the script runs through a symlinked skill folder, up to the planner's own message", (t) => {
  const repo = scratch(t);
  symlinkSync(SKILL, join(repo, "linked-skill"));
  mkdirSync(join(repo, "launch-video"));
  const story = validStory2();
  const long = (n) => text(n);
  story.scenes = [
    { type: "hook", lines: [hookLine(), hookLine(), hookLine()] },
    { type: "title", promise: long(LIMITS.promise) },
    { type: "terminal", command: long(LIMITS.command), output: Array(12).fill(long(LIMITS.outputLine)), highlight: [10, 11] },
    { type: "list", items: [0, 1, 2].map(() => long(LIMITS.listItem)) },
    { type: "list", items: [0, 1, 2].map(() => long(LIMITS.listItem)) },
    { type: "counter", items: [0, 1, 2].map(() => ({ value: 1, label: long(LIMITS.counterLabel), note: long(LIMITS.note) })) },
    { type: "end" },
  ];
  writeFileSync(join(repo, "launch-video/story.json"), JSON.stringify(story));
  const run = spawnSync("node", [join(repo, "linked-skill/scripts/render.mjs")], { cwd: repo, encoding: "utf8" });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /^✗ Too much to read in 35 s: remove a scene or shorten text in scenes\[\d\] \(\w+\)\n$/);
  assert.deepEqual(readdirSync(join(repo, "launch-video")), ["story.json"], "nothing was written");
});
