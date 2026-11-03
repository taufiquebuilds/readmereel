import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject, LAYOUTS, musicTag, variablesFor } from "../skills/readmereel/scripts/lib/build.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

function variables(html) {
  const raw = html.match(/data-composition-variables='([^']*)'/)[1];
  return Object.fromEntries(
    JSON.parse(raw.replaceAll("&#39;", "'").replaceAll("&amp;", "&")).map((v) => [v.id, v]),
  );
}

test("layouts and output names", () => {
  assert.deepEqual(LAYOUTS.wide, { width: 1920, height: 1080, video: "video-16x9.mp4" });
  assert.deepEqual(LAYOUTS.tall, { width: 1080, height: 1920, video: "video-9x16.mp4" });
});

test("variables carry the story with defaults", () => {
  const story = validStory();
  delete story.accent;
  const vars = Object.fromEntries(variablesFor(story, { logo: "", f1Image: "assets/f1.png", f2Image: "", f3Image: "" }).map((v) => [v.id, v]));
  assert.equal(vars.name.default, "agencyrecap");
  assert.equal(vars.f1Title.default, "Branded PDF every month");
  assert.equal(vars.f1Image.default, "assets/f1.png");
  assert.equal(vars.f2Image.default, "");
  assert.deepEqual(vars.accent, { id: "accent", type: "color", label: "accent", default: "#22c55e" });
  assert.deepEqual(vars.stars, { id: "stars", type: "number", label: "stars", default: 0 });
  assert.deepEqual(vars.endCard, { id: "endCard", type: "boolean", label: "endCard", default: true });
});

test("builds a wide project with sizes, layout and copied images", () => {
  const base = tmpDir();
  writeFileSync(join(base, "shot.png"), "png-bytes");
  const story = validStory();
  story.features[0].image = "shot.png";
  story.name = "it's & co";
  story.promise = "Pay $$$ less and save $& more";
  const out = tmpDir();
  const dir = buildProject(story, "wide", { baseDir: base, outDir: out });
  assert.equal(dir, join(out, "wide"));
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(html.includes('data-width="1920"') && html.includes('data-height="1080"'));
  assert.ok(html.includes('<body class="wide">'));
  assert.ok(!/__[A-Z]+__/.test(html), "every placeholder is replaced");
  const vars = variables(html);
  assert.equal(vars.name.default, "it's & co");
  assert.equal(vars.promise.default, "Pay $$$ less and save $& more");
  assert.equal(vars.f1Image.default, "assets/f1.png");
  assert.equal(readFileSync(join(dir, "assets/f1.png"), "utf8"), "png-bytes");
  assert.ok(existsSync(join(dir, "hyperframes.json")));
  assert.ok(!html.includes('<audio id="music"'));
});

test("builds a tall project with music and a logo", () => {
  const base = tmpDir();
  writeFileSync(join(base, "song.mp3"), "mp3");
  writeFileSync(join(base, "logo.svg"), "<svg/>");
  const story = { ...validStory(), music: "song.mp3", logo: "logo.svg", endCard: false };
  const dir = buildProject(story, "tall", { baseDir: base, outDir: tmpDir() });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(html.includes('data-width="1080"') && html.includes('data-height="1920"'));
  assert.ok(html.includes('<body class="tall">'));
  assert.ok(html.includes(musicTag("assets/music.mp3")));
  const vars = variables(html);
  assert.equal(vars.logo.default, "assets/logo.svg");
  assert.equal(vars.endCard.default, false);
});

test("rebuilding replaces the old project", () => {
  const out = tmpDir();
  const dir = buildProject(validStory(), "wide", { baseDir: tmpDir(), outDir: out });
  writeFileSync(join(dir, "stale.txt"), "old");
  buildProject(validStory(), "wide", { baseDir: tmpDir(), outDir: out });
  assert.ok(!existsSync(join(dir, "stale.txt")));
});

test("music fades in and out over the whole video", () => {
  const tag = musicTag("assets/music.mp3");
  assert.ok(tag.startsWith('<audio id="music" src="assets/music.mp3" data-start="0" data-duration="25"'));
  assert.ok(tag.includes('{"t":1,"v":0.6}') && tag.includes('{"t":25,"v":0}'));
  assert.equal(musicTag(""), "");
});

test("unknown layout is an error", () => {
  assert.throws(() => buildProject(validStory(), "square", { baseDir: tmpDir(), outDir: tmpDir() }), /unknown layout: square/);
});
