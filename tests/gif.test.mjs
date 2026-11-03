import { test } from "node:test";
import assert from "node:assert/strict";
import { GIF, gifArgs, makeGif } from "../skills/readmereel/scripts/lib/gif.mjs";

test("GIF settings", () => {
  assert.deepEqual(GIF, { width: 960, fps: 12, maxBytes: 8 * 1024 * 1024, fallbackSeconds: 12 });
  const args = gifArgs("in.mp4", "out.gif");
  assert.ok(args.join(" ").includes("fps=12,scale=960:-1"));
  assert.ok(args.join(" ").includes("palettegen") && args.join(" ").includes("paletteuse"));
  assert.ok(!args.includes("-t"));
  assert.deepEqual(gifArgs("in.mp4", "out.gif", 12).slice(3, 5), ["-t", "12"]);
});

test("a GIF over 8 MB is remade from the first 12 seconds", () => {
  const calls = [];
  const sizes = [9 * 1024 * 1024, 5 * 1024 * 1024];
  const final = makeGif("in.mp4", "out.gif", {
    run: (cmd, args) => { calls.push(args); return { status: 0, stderr: "" }; },
    size: () => sizes.shift(),
  });
  assert.equal(calls.length, 2);
  assert.ok(calls[1].includes("-t"));
  assert.equal(final, 5 * 1024 * 1024);
});

test("ffmpeg failure is an error", () => {
  assert.throws(
    () => makeGif("in.mp4", "out.gif", { run: () => ({ status: 1, stderr: "bad input" }), size: () => 0 }),
    /ffmpeg could not make the GIF: bad input/,
  );
});

test("a GIF under 8 MB needs only one ffmpeg call", () => {
  const calls = [];
  const final = makeGif("in.mp4", "out.gif", {
    run: (cmd, args) => { calls.push(args); return { status: 0, stderr: "" }; },
    size: () => 3 * 1024 * 1024,
  });
  assert.equal(calls.length, 1);
  assert.equal(final, 3 * 1024 * 1024);
});

test("an ffmpeg spawn error names the cause, never null", () => {
  const run = () => ({ status: null, stderr: null, error: new Error("spawn ffmpeg ENOENT") });
  assert.throws(
    () => makeGif("in.mp4", "out.gif", { run, size: () => 0 }),
    (e) => /ffmpeg could not make the GIF: spawn ffmpeg ENOENT/.test(e.message) && !/null/.test(e.message),
  );
});
