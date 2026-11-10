import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { canvas, drawLabel, framesOf, midFrame, posterScene, sceneLabel, sheetLayout, TILE } from "../skills/readmereel/scripts/lib/sheet.mjs";
import { tmpDir } from "./helpers.mjs";

// A lossless video whose frame k is grey level 20 k, so a frame read back says which frame it was.
function countingVideo(frames = 10) {
  const file = join(tmpDir(), "count.mkv");
  const w = 32, h = 18;
  const raw = Buffer.concat(Array.from({ length: frames }, (_, k) => Buffer.alloc(w * h * 3, 20 * k)));
  const made = spawnSync("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${w}x${h}`, "-r", "30", "-i", "-",
    "-c:v", "ffv1", "-pix_fmt", "bgr0", file], { input: raw });
  assert.equal(made.status, 0, String(made.stderr));
  return file;
}

test("frames are picked by number, in the order asked, repeats allowed", () => {
  const video = countingVideo();
  const frames = framesOf(video, [7, 0, 3, 7], 16, 9);
  assert.deepEqual(frames.map((f) => f.data[0]), [140, 0, 60, 140]);
  assert.ok(frames.every((f) => f.width === 16 && f.height === 9 && f.data.length === 16 * 9 * 3));
  assert.throws(() => framesOf(video, [3, 40], 16, 9), /returned 1 of 2 frames/);
});

test("a scene's midpoint frame, its label, and the poster's scene", () => {
  assert.equal(midFrame({ start: 2.5, duration: 3.2 }), 123);
  assert.equal(sceneLabel({ id: "s3", type: "ui" }), "s3 ui");
  const plan = (...types) => ({ scenes: types.map((type, i) => ({ id: `s${i + 1}`, type })) });
  assert.equal(posterScene(plan("hook", "ui", "title", "end")).type, "title");
  assert.equal(posterScene(plan("hook", "terminal", "ui", "ui", "end")).id, "s3");
  assert.equal(posterScene(plan("hook", "terminal", "list", "end")).id, "s2");
});

test("the sheet: one column per scene, wide on top, tall below at the same height and centred", () => {
  const l = sheetLayout(3);
  assert.equal(l.width, TILE.gap + 3 * (TILE.width + TILE.gap));
  assert.equal(l.height, TILE.gap + 2 * (TILE.height + TILE.gap));
  assert.deepEqual(l.tiles[1], { wide: { x: 672, y: 16 }, tall: { x: 672 + 219, y: 392 } });
  assert.ok(Math.abs((1080 / 1920) * TILE.height - TILE.tallWidth) <= 0.5, "the tall tile keeps the 9:16 shape");
});

test("labels are drawn in white on a dark box, one 5 x 7 glyph per character", () => {
  const img = canvas(200, 40, [200, 0, 0]);
  const box = drawLabel(img, "s1 hook", 0, 0, 2);
  assert.deepEqual(box, { width: 7 * 12 - 2 + 8, height: 14 + 8 });
  const px = (x, y) => [...img.data.subarray((y * 200 + x) * 3, (y * 200 + x) * 3 + 3)];
  assert.deepEqual(px(1, 1), [56, 0, 0], "the box darkens what is under it");
  // "s" row 2 is " ####": its second column is ink.
  assert.deepEqual(px(4 + 1 * 2, 4 + 2 * 2), [255, 255, 255]);
  assert.deepEqual(px(150, 30), [200, 0, 0], "nothing outside the box changes");
});
