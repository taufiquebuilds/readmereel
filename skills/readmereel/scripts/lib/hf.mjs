import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gateProblems, loadProject } from "./gate.mjs";

export const HF = ["--yes", "hyperframes@0.9.9"];

const MINUTE = 60_000;
export const TIMEOUTS = { browser: 10 * MINUTE, check: 5 * MINUTE, render: 20 * MINUTE };

const seeLog = (log) => (log ? `. See ${log}` : "");

function parseReport(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) return undefined;
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

// npx runs from a private folder inside the temp dir, never inside the project: npm reads the nearest package.json and
// .npmrc above its cwd. A shared /tmp is not safe either (/tmp/.npmrc, /tmp/node_modules), so make one folder per process.
// The folder stays empty (npx caches elsewhere) and is removed when the process exits.
let npxDir;
function npxCwd() {
  if (!npxDir) {
    npxDir = mkdtempSync(join(tmpdir(), "readmereel-npx-"));
    const made = npxDir;
    process.once("exit", () => rmSync(made, { recursive: true, force: true }));
  }
  return npxDir;
}

export function runHf(args, { log, run = spawnSync, timeout } = {}) {
  const full = [...HF, ...args];
  const result = run("npx", full, {
    cwd: npxCwd(),
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout,
  });
  if (log) {
    const failure = result.error ? `error: ${result.error.message}\n` : "";
    appendFileSync(log, `$ npx ${full.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}\n${failure}`);
  }
  return result;
}

function causeOf(result, timeout) {
  if (!result.error) return "";
  if (result.error.code === "ETIMEDOUT") return `: timed out after ${timeout / MINUTE} minutes`;
  return `: ${result.error.message}`;
}

export function ensureBrowser({ log, run } = {}) {
  const result = runHf(["browser", "ensure"], { log, run, timeout: TIMEOUTS.browser });
  if (result.status !== 0) {
    const cause = causeOf(result, TIMEOUTS.browser);
    throw new Error(`Could not set up Chrome for rendering${cause}${seeLog(log)}`);
  }
}

// HyperFrames downgrades a layout finding seen in only one sample to "info", which this gate ignores. Its default of 9
// samples leaves short scenes with a single sample, so sample at least once a second of the film (and never under 25).
export const checkSamples = (duration) => Math.max(25, Math.ceil(Number(duration) || 0));

// Runs `hyperframes check` on a built project and returns its blocking problems (see gate.mjs): every error, and the
// readability warnings about readmereel's own text. Fails closed: no JSON is an error, and a failed check that lists
// nothing still returns a problem.
export function checkProject(projectDir, { log, run, duration } = {}) {
  const args = ["check", "--json", "--samples", String(checkSamples(duration)), resolve(projectDir)];
  const result = runHf(args, { log, run, timeout: TIMEOUTS.check });
  if (result.error) {
    throw new Error(`Could not run HyperFrames check${causeOf(result, TIMEOUTS.check)}${seeLog(log)}`);
  }
  const report = parseReport(result.stdout);
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error(`HyperFrames check did not return JSON${seeLog(log)}`);
  }
  const problems = gateProblems(report, () => loadProject(projectDir));
  const failed = report.ok === false || (typeof result.status === "number" && result.status !== 0);
  if (!problems.length && failed) {
    return [`check: HyperFrames check failed without listing errors${seeLog(log)}`];
  }
  return problems;
}

export function renderProject(projectDir, output, { log, quality = "looks", run } = {}) {
  const args = ["render", "--quality", quality, "--quiet", "--output", resolve(output), resolve(projectDir)];
  const result = runHf(args, { log, run, timeout: TIMEOUTS.render });
  if (result.status !== 0) {
    const cause = causeOf(result, TIMEOUTS.render);
    throw new Error(`Render failed for ${projectDir}${cause}${seeLog(log)}`);
  }
}
