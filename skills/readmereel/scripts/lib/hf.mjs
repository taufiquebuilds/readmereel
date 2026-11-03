import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

export const HF = ["--yes", "hyperframes@0.9.9"];

export function runHf(args, { cwd, log, run = spawnSync } = {}) {
  const full = [...HF, ...args];
  const result = run("npx", full, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (log) appendFileSync(log, `$ npx ${full.join(" ")}\n${result.stdout ?? ""}${result.stderr ?? ""}\n`);
  return result;
}

export function ensureBrowser({ log, run } = {}) {
  if (runHf(["browser", "ensure"], { log, run }).status !== 0) {
    throw new Error(`Could not set up Chrome for rendering. See ${log}`);
  }
}

export function checkProject(projectDir, { log, run } = {}) {
  const result = runHf(["check", "--json"], { cwd: projectDir, log, run });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`HyperFrames check did not return JSON. See ${log}`);
  }
  const problems = [];
  for (const [section, value] of Object.entries(report)) {
    if (!value || typeof value !== "object" || !Array.isArray(value.findings)) continue;
    for (const f of value.findings) if (f.severity === "error") problems.push(`${section}: ${f.code}: ${f.message}`);
  }
  return problems;
}

export function renderProject(projectDir, output, { log, quality = "looks", run } = {}) {
  const result = runHf(["render", "--quality", quality, "--quiet", "--output", output], { cwd: projectDir, log, run });
  if (result.status !== 0) throw new Error(`Render failed for ${projectDir}. See ${log}`);
}
