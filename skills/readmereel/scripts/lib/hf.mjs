import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const HF = ["--yes", "hyperframes@0.9.9"];

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

export function runHf(args, { cwd, log, run = spawnSync } = {}) {
  const full = [...HF, ...args];
  const result = run("npx", full, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (log) {
    const failure = result.error ? `error: ${result.error.message}\n` : "";
    appendFileSync(log, `$ npx ${full.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}\n${failure}`);
  }
  return result;
}

export function ensureBrowser({ log, run } = {}) {
  const result = runHf(["browser", "ensure"], { log, run });
  if (result.status !== 0) {
    const cause = result.error ? `: ${result.error.message}` : "";
    throw new Error(`Could not set up Chrome for rendering${cause}${seeLog(log)}`);
  }
}

export function checkProject(projectDir, { log, run } = {}) {
  const result = runHf(["check", "--json"], { cwd: projectDir, log, run });
  if (result.error) {
    throw new Error(`Could not run HyperFrames check: ${result.error.message}${seeLog(log)}`);
  }
  const report = parseReport(result.stdout);
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    throw new Error(`HyperFrames check did not return JSON${seeLog(log)}`);
  }
  const problems = [];
  for (const [section, value] of Object.entries(report)) {
    if (!value || typeof value !== "object" || !Array.isArray(value.findings)) continue;
    for (const f of value.findings) if (f.severity === "error") problems.push(`${section}: ${f.code}: ${f.message}`);
  }
  const failed = report.ok === false || (typeof result.status === "number" && result.status !== 0);
  if (!problems.length && failed) {
    return [`check: HyperFrames check failed without listing errors${seeLog(log)}`];
  }
  return problems;
}

export function renderProject(projectDir, output, { log, quality = "looks", run } = {}) {
  const result = runHf(["render", "--quality", quality, "--quiet", "--output", output], { cwd: projectDir, log, run });
  if (result.status !== 0) {
    const cause = result.error ? `: ${result.error.message}` : "";
    throw new Error(`Render failed for ${projectDir}${cause}${seeLog(log)}`);
  }
}
