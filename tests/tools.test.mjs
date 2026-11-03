import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTools } from "../skills/readmereel/scripts/lib/tools.mjs";

test("all tools present", () => {
  assert.deepEqual(checkTools({ nodeVersion: "22.4.0", has: () => true }), []);
});

test("old Node and missing ffmpeg are reported with how to fix them", () => {
  const missing = checkTools({ nodeVersion: "20.11.1", has: (cmd) => cmd !== "ffmpeg" });
  assert.equal(missing.length, 2);
  assert.match(missing[0], /Node\.js 22 or newer is needed \(you have 20\.11\.1\)/);
  assert.match(missing[1], /ffmpeg is needed.*brew install ffmpeg/);
});
