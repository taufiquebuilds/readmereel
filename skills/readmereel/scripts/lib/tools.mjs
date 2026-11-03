import { spawnSync } from "node:child_process";

export function commandExists(cmd) {
  return spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;
}

export function checkTools({ nodeVersion = process.versions.node, has = commandExists } = {}) {
  const missing = [];
  if (Number(nodeVersion.split(".")[0]) < 22) {
    missing.push(`Node.js 22 or newer is needed (you have ${nodeVersion}). Install it from https://nodejs.org`);
  }
  for (const tool of ["ffmpeg", "ffprobe"]) {
    if (!has(tool)) missing.push(`${tool} is needed. Install it: brew install ffmpeg (macOS) or sudo apt install ffmpeg (Linux)`);
  }
  return missing;
}
