import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, validateStory } from "../skills/readmereel/scripts/lib/story.mjs";
import { tmpDir, validStory } from "./helpers.mjs";

test("a valid story has no errors", () => {
  assert.deepEqual(validateStory(validStory(), tmpDir()), []);
});

test("rejects a non-object", () => {
  assert.deepEqual(validateStory([], tmpDir()), ["story.json must be a JSON object"]);
});

test("each text field has a length limit", () => {
  const story = validStory();
  story.name = "x".repeat(LIMITS.name + 1);
  story.features[1].detail = "y".repeat(LIMITS.featureDetail + 1);
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes(`name: ${LIMITS.name + 1} characters, the limit is ${LIMITS.name}`));
  assert.ok(errors.includes(`features[2].detail: ${LIMITS.featureDetail + 1} characters, the limit is ${LIMITS.featureDetail}`));
});

test("text at exactly the limit is fine", () => {
  const story = validStory();
  story.problem = "p".repeat(LIMITS.problem);
  assert.deepEqual(validateStory(story, tmpDir()), []);
});

test("required text and one line", () => {
  const story = validStory();
  story.promise = "";
  story.install = "npm i\nnpm start";
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes("promise: required text"));
  assert.ok(errors.includes("install: must be one line"));
});

test("exactly three features", () => {
  const story = validStory();
  story.features.pop();
  assert.deepEqual(validateStory(story, tmpDir()), ["features: must be a list of exactly 3"]);
});

test("image files must exist and be images", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, "shot.png"), "png");
  const story = validStory();
  story.features[0].image = "shot.png";
  story.features[1].image = "missing.png";
  story.features[2].image = "notes.txt";
  const errors = validateStory(story, dir);
  assert.deepEqual(errors, [
    "features[2].image: file not found: missing.png",
    "features[3].image: must be a path to an image (png, jpg, gif, svg, webp) file",
  ]);
});

test("logo must be png or svg, music must be audio", () => {
  const story = validStory();
  story.logo = "logo.jpg";
  story.music = "song.txt";
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes("logo: must be a path to a PNG or SVG file"));
  assert.ok(errors.includes("music: must be a path to an audio (mp3, m4a, wav, ogg) file"));
});

test("accent, stars, endCard and url rules", () => {
  const story = validStory();
  story.accent = "teal";
  story.stars = -3;
  story.endCard = "no";
  story.url = "not a url";
  const errors = validateStory(story, tmpDir());
  assert.ok(errors.includes("accent: must be a hex colour like #0f766e"));
  assert.ok(errors.includes("stars: must be a whole number or null"));
  assert.ok(errors.includes("endCard: must be true or false"));
  assert.ok(errors.includes("url: must be a web address like github.com/you/repo"));
});

test("unknown fields are reported so typos are caught", () => {
  const story = validStory();
  story.promis = "typo";
  assert.deepEqual(validateStory(story, tmpDir()), ["promis: unknown field"]);
});
