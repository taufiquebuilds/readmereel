import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkProject, HF, renderProject, runHf } from "../skills/readmereel/scripts/lib/hf.mjs";
import { tmpDir } from "./helpers.mjs";

function fakeRun(result, calls = []) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd });
    return { status: 0, stdout: "", stderr: "", ...result };
  };
}

test("runs the pinned HyperFrames version and logs the output", () => {
  const log = join(tmpDir(), "render.log");
  const calls = [];
  runHf(["info"], { cwd: "/p", log, run: fakeRun({ stdout: "hello" }, calls) });
  assert.deepEqual(HF, ["--yes", "hyperframes@0.9.9"]);
  assert.deepEqual(calls[0], { cmd: "npx", args: ["--yes", "hyperframes@0.9.9", "info"], cwd: "/p" });
  assert.match(readFileSync(log, "utf8"), /\$ npx --yes hyperframes@0\.9\.9 info\nhello/);
});

test("check returns only error findings", () => {
  const report = {
    ok: false,
    lint: { errorCount: 0, findings: [{ severity: "warning", code: "film_silent", message: "no sound" }] },
    layout: { errorCount: 1, findings: [{ severity: "error", code: "text_overflow", message: "#s1-text overflows" }] },
  };
  const problems = checkProject("/p", { log: join(tmpDir(), "l"), run: fakeRun({ stdout: JSON.stringify(report) }) });
  assert.deepEqual(problems, ["layout: text_overflow: #s1-text overflows"]);
});

test("check output that is not JSON is an error", () => {
  assert.throws(
    () => checkProject("/p", { log: "/tmp/readmereel-x.log", run: fakeRun({ stdout: "boom" }) }),
    /HyperFrames check did not return JSON\. See \/tmp\/readmereel-x\.log/,
  );
});

test("render passes quality and output, and fails loudly", () => {
  const calls = [];
  renderProject("/p", "/out/v.mp4", { log: join(tmpDir(), "l"), quality: "draft", run: fakeRun({}, calls) });
  assert.deepEqual(calls[0].args.slice(2), ["render", "--quality", "draft", "--quiet", "--output", "/out/v.mp4"]);
  assert.throws(
    () => renderProject("/p", "/out/v.mp4", { log: "/tmp/r.log", run: fakeRun({ status: 1 }) }),
    /Render failed for \/p\. See \/tmp\/r\.log/,
  );
});
