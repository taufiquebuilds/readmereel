import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkProject, ensureBrowser, HF, renderProject, runHf } from "../skills/readmereel/scripts/lib/hf.mjs";
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

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const logIn = () => join(tmpDir(), "hf.log");

test("check output that is not JSON is an error", () => {
  const log = logIn();
  assert.throws(
    () => checkProject("/p", { log, run: fakeRun({ stdout: "boom" }) }),
    new RegExp(`HyperFrames check did not return JSON\\. See ${esc(log)}`),
  );
});

test("a spawn error is logged and reported as a failed check", () => {
  const log = logIn();
  const run = fakeRun({ status: null, stdout: null, stderr: null, error: new Error("spawn npx ENOENT") });
  assert.throws(
    () => checkProject("/p", { log, run }),
    new RegExp(`Could not run HyperFrames check: spawn npx ENOENT\\. See ${esc(log)}`),
  );
  assert.match(readFileSync(log, "utf8"), /error: spawn npx ENOENT/);
});

test("check parses JSON that follows a preamble", () => {
  const report = { ok: false, layout: { findings: [{ severity: "error", code: "x", message: "m" }] } };
  const stdout = `notice: update available\n${JSON.stringify(report)}\n`;
  assert.deepEqual(checkProject("/p", { log: logIn(), run: fakeRun({ stdout, status: 1 }) }), ["layout: x: m"]);
});

test("a failed check that lists no errors still fails closed", () => {
  const log = logIn();
  const run = fakeRun({ stdout: JSON.stringify({ ok: false, lint: { findings: [] } }), status: 1 });
  assert.deepEqual(checkProject("/p", { log, run }), [
    `check: HyperFrames check failed without listing errors. See ${log}`,
  ]);
});

test("a non-zero exit with ok:true and no errors still fails closed", () => {
  const run = fakeRun({ stdout: JSON.stringify({ ok: true }), status: 2 });
  assert.equal(checkProject("/p", { log: logIn(), run }).length, 1);
});

test("warnings alone with ok:true and exit 0 pass", () => {
  const report = { ok: true, lint: { findings: [{ severity: "warning", code: "w", message: "m" }] } };
  assert.deepEqual(checkProject("/p", { log: logIn(), run: fakeRun({ stdout: JSON.stringify(report) }) }), []);
});

test("JSON that is not an object is an error", () => {
  const log = logIn();
  assert.throws(
    () => checkProject("/p", { log, run: fakeRun({ stdout: "5" }) }),
    /HyperFrames check did not return JSON/,
  );
  assert.throws(
    () => checkProject("/p", { log, run: fakeRun({ stdout: "null" }) }),
    /HyperFrames check did not return JSON/,
  );
  assert.throws(
    () => checkProject("/p", { log, run: fakeRun({ stdout: "[]" }) }),
    /HyperFrames check did not return JSON/,
  );
});

test("render passes quality and output, and fails loudly", () => {
  const calls = [];
  const log = logIn();
  renderProject("/p", "/out/v.mp4", { log, quality: "draft", run: fakeRun({}, calls) });
  assert.deepEqual(calls[0].args.slice(2), ["render", "--quality", "draft", "--quiet", "--output", "/out/v.mp4"]);
  assert.throws(
    () => renderProject("/p", "/out/v.mp4", { log, run: fakeRun({ status: 1 }) }),
    new RegExp(`Render failed for /p\\. See ${esc(log)}`),
  );
});

test("render and browser setup report the spawn error, and omit a missing log", () => {
  const run = fakeRun({ status: null, error: new Error("spawn npx ENOENT") });
  const log = logIn();
  assert.throws(
    () => renderProject("/p", "/o.mp4", { log, run }),
    new RegExp(`Render failed for /p: spawn npx ENOENT\\. See ${esc(log)}`),
  );
  assert.throws(() => renderProject("/p", "/o.mp4", { run }), (e) => e.message === "Render failed for /p: spawn npx ENOENT");
  assert.throws(() => ensureBrowser({ run }), (e) => e.message === "Could not set up Chrome for rendering: spawn npx ENOENT");
  assert.throws(() => ensureBrowser({ run: fakeRun({ status: 1 }) }), (e) => e.message === "Could not set up Chrome for rendering");
});
