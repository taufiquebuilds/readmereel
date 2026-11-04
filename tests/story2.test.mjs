import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, ftruncateSync, linkSync, mkdirSync, openSync, symlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { LIMITS, imageSize, toV2, validateStory } from "../skills/readmereel/scripts/lib/story.mjs";
import { tmpDir, validStory, validStory2 } from "./helpers.mjs";

const errs = (s, dir = tmpDir()) => validateStory(s, dir);

test("a valid v2 story has no errors", () => {
  assert.deepEqual(errs(validStory2()), []);
});

test("scene order and counts", () => {
  const s = validStory2();
  s.scenes = s.scenes.slice(1);
  assert.ok(errs(s).includes("scenes: the first scene must be a hook"));
  const t = validStory2();
  t.scenes.push({ type: "list", items: ["a", "b", "c"] });
  assert.ok(errs(t).includes("scenes: the last scene must be end"));
  const u = validStory2();
  u.scenes.splice(1, 0, { type: "title", promise: "Again" });
  assert.ok(errs(u).includes("scenes: title can appear at most once"));
  const v = validStory2();
  v.scenes = [v.scenes[0], v.scenes.at(-1)];
  assert.ok(errs(v).includes("scenes: use 5 to 8 scenes (you have 2)"));
});

test("hook rules", () => {
  const s = validStory2();
  s.scenes[0] = { type: "hook", lines: ["one two three four five"], count: { line: 0, to: 40 } };
  const e = errs(s);
  assert.ok(e.includes("scenes[0].lines[0]: at most 4 words"));
  assert.ok(e.includes("scenes[0].count: line 0 must contain the number 40"));
});

test("ui needs exactly one of image or html, and boxes are numbers", () => {
  const s = validStory2();
  s.scenes[2] = { type: "ui", focus: [{ box: [1, 2, 3] }] };
  const e = errs(s);
  assert.ok(e.includes("scenes[2]: give either image or html"));
  assert.ok(e.includes("scenes[2].focus[0].box: must be [x, y, width, height] in pixels"));
});

test("ui states are spaced at least 0.4 s apart", () => {
  const dir = tmpDir();
  mkdirSync(join(dir, "s"));
  writeFileSync(join(dir, "s/screen.html"), "<div></div>");
  const s = validStory2();
  s.scenes[2] = { type: "ui", html: "s/screen.html", focus: [{ box: [0, 0, 100, 100] }],
    states: [{ at: 1, selector: "#a", set: "on" }, { at: 1.2, selector: "#b", set: "on" }] };
  assert.ok(errs(s, dir).includes("scenes[2].states[1].at: states must be at least 0.4 s apart"));
});

test("terminal, counter, compare, list limits", () => {
  const s = validStory2();
  s.scenes.splice(1, 3,
    { type: "terminal", command: "x".repeat(LIMITS.command + 1), output: [] },
    { type: "counter", items: [{ value: "12", label: "Stars" }] },
    { type: "compare", before: { label: "A", points: ["a"] }, after: { label: "B" } });
  const e = errs(s);
  assert.ok(e.includes(`scenes[1].command: ${LIMITS.command + 1} characters, the limit is ${LIMITS.command}`));
  assert.ok(e.includes("scenes[1].output: 1 to 12 lines"));
  assert.ok(e.includes("scenes[2].items[0].value: must be a real number"));
  assert.ok(e.includes("scenes[3].after: give either image or points"));
});

test("install placeholders and unknown fields are rejected", () => {
  const s = validStory2();
  s.install = "repoheat --user <your-username>";
  s.scenes[0].colour = "red";
  const e = errs(s);
  assert.ok(e.includes("install: use a real value, not a placeholder like <your-username>"));
  assert.ok(e.includes("scenes[0].colour: unknown field"));
});

test("v1 stories convert to v2 and validate", () => {
  const v2 = toV2(validStory());
  assert.equal(v2.version, 2);
  assert.equal(v2.scenes[0].type, "hook");
  assert.equal(v2.scenes[1].type, "title");
  assert.equal(v2.scenes.at(-1).type, "end");
  assert.ok(v2.scenes.length >= 5);
  assert.deepEqual(validateStory(validStory(), tmpDir()), []);
});

function pngHeader(w, h) {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test("image sizes are read from PNG, SVG and JPEG headers, with a fallback", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, "a.png"), pngHeader(1280, 720));
  writeFileSync(join(dir, "b.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400"></svg>');
  writeFileSync(join(dir, "c.svg"), '<svg width="640px" height="480"></svg>');
  writeFileSync(join(dir, "d.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0x01, 0x90, 0x03, 0x20, 3, 1, 0x22, 0, 2, 0x11, 1]));
  writeFileSync(join(dir, "e.png"), "not an image");
  assert.deepEqual(imageSize(join(dir, "a.png")), [1280, 720]);
  assert.deepEqual(imageSize(join(dir, "b.svg")), [800, 400]);
  assert.deepEqual(imageSize(join(dir, "c.svg")), [640, 480]);
  assert.deepEqual(imageSize(join(dir, "d.jpg")), [800, 400]);
  assert.deepEqual(imageSize(join(dir, "e.png")), [1600, 1000]);
  assert.deepEqual(imageSize(join(dir, "missing.png")), [1600, 1000]);
});

test("v1 image features become ui scenes covering the whole image; extras fold into the list", () => {
  const dir = tmpDir();
  writeFileSync(join(dir, "a.png"), pngHeader(1280, 720));
  const one = validStory();
  one.features[0].image = "a.png";
  const v2 = toV2(one, dir);
  assert.deepEqual(v2.scenes.map((s) => s.type), ["hook", "title", "ui", "list", "end"]);
  assert.deepEqual(v2.scenes[2].focus[0].box, [0, 0, 1280, 720]);
  assert.deepEqual(validateStory(one, dir), []);

  const three = validStory();
  three.features.forEach((f) => { f.image = "a.png"; });
  const v3 = toV2(three, dir);
  assert.equal(v3.scenes.filter((s) => s.type === "ui").length, 2);
  assert.equal(v3.scenes.find((s) => s.type === "list").items.length, 3);
  assert.deepEqual(validateStory(three, dir), []);
});

test("v1 hook text is split into at most 3 short lines", () => {
  const s = validStory();
  s.problem = "Client reporting tools charge you more for every client you win now";
  const lines = toV2(s).scenes[0].lines;
  assert.ok(lines.length >= 1 && lines.length <= 3);
  for (const l of lines) assert.ok(l.length <= LIMITS.hookLine && l.split(" ").length <= LIMITS.hookWords);
  assert.deepEqual(validateStory(s, tmpDir()), []);
});

test("v1 errors are reported with v1 paths before conversion", () => {
  const s = validStory();
  s.features.pop();
  assert.deepEqual(validateStory(s, tmpDir()), ["features: must be a list of exactly 3"]);
});

// ---- round 3 G: imageSize only reads the header of a plain image file inside the story folder ----

const STORY_URL = new URL("../skills/readmereel/scripts/lib/story.mjs", import.meta.url).href;
// In a child with a time limit, so a blocking read (a FIFO) fails the test instead of hanging it.
function sizeInChild(path, base) {
  const code = `import { imageSize } from ${JSON.stringify(STORY_URL)}; console.log(JSON.stringify(imageSize(${JSON.stringify(path)}, ${JSON.stringify(base)})));`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10000 });
  return r.error ? `child failed: ${r.error.code}` : JSON.parse(r.stdout);
}

test("round 3 G: imageSize refuses FIFOs, outside symlinks, hard links and huge files, and falls back", () => {
  const dir = tmpDir();
  const outside = tmpDir();
  writeFileSync(join(outside, "secret.png"), pngHeader(1280, 720));
  writeFileSync(join(dir, "real.png"), pngHeader(1280, 720));
  assert.equal(spawnSync("mkfifo", [join(dir, "pipe.png")]).status, 0);
  assert.deepEqual(sizeInChild(join(dir, "pipe.png"), dir), [1600, 1000], "a FIFO is not read");
  symlinkSync(join(outside, "secret.png"), join(dir, "out.png"));
  assert.deepEqual(imageSize(join(dir, "out.png"), dir), [1600, 1000], "symlink to a file outside the story folder");
  symlinkSync(join(dir, "real.png"), join(dir, "in.png"));
  assert.deepEqual(imageSize(join(dir, "in.png"), dir), [1280, 720], "symlink that stays inside the story folder");
  symlinkSync("/dev/zero", join(dir, "zero.png"));
  assert.deepEqual(sizeInChild(join(dir, "zero.png"), dir), [1600, 1000], "a device is not read");
  assert.deepEqual(imageSize(join(outside, "secret.png"), dir), [1600, 1000], "a path outside the story folder");
  linkSync(join(outside, "secret.png"), join(dir, "hard.png"));
  assert.deepEqual(imageSize(join(dir, "hard.png"), dir), [1600, 1000], "a hard link");
  mkdirSync(join(dir, "folder.png"));
  assert.deepEqual(imageSize(join(dir, "folder.png"), dir), [1600, 1000], "a directory");
  // over 25 MB: refused from its size alone (sparse, so the test does not write 25 MB)
  const fd = openSync(join(dir, "huge.png"), "w");
  writeSync(fd, pngHeader(1280, 720));
  ftruncateSync(fd, 25 * 1024 * 1024 + 1);
  closeSync(fd);
  assert.deepEqual(imageSize(join(dir, "huge.png"), dir), [1600, 1000], "over 25 MB");
});

test("round 3 G: a JPEG whose size marker sits after large segments is still read from its header", () => {
  const dir = tmpDir();
  const app = Buffer.alloc(4 + 60000);
  app[0] = 0xff; app[1] = 0xe1; app.writeUInt16BE(60000 + 2, 2);
  const parts = [Buffer.from([0xff, 0xd8]), app, app, app, Buffer.from([0xff, 0xc2, 0, 17, 8, 0x02, 0x58, 0x04, 0x00, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])];
  writeFileSync(join(dir, "big.jpg"), Buffer.concat(parts));
  assert.deepEqual(imageSize(join(dir, "big.jpg"), dir), [1024, 600]);
  // v1 conversion passes the story folder, so a v1 image outside it gets the default box
  const s = validStory();
  s.features[0].image = "../x.png";
  assert.deepEqual(toV2(s, dir).scenes[2].focus[0].box, [0, 0, 1600, 1000]);
});
