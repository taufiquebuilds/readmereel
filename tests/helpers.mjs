import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

// Every folder tmpDir made in this test file, removed when the file's tests end (KEEP_RENDERS=1 keeps them to look
// at). Only these folders: nothing else in the temp dir is touched.
const made = new Set();
after(() => {
  if (process.env.KEEP_RENDERS) return;
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
  made.clear();
});

export function tmpDir() {
  const dir = mkdtempSync(join(tmpdir(), "readmereel-"));
  made.add(dir);
  return dir;
}

export function validStory() {
  return {
    name: "agencyrecap",
    promise: "Monthly client reports that send themselves",
    problem: "Client reporting tools charge you more for every client you win",
    features: [
      { title: "Branded PDF every month", detail: "Your logo and colour, emailed to each client on the day you pick" },
      { title: "One dashboard", detail: "See which reports went out and send again in one click" },
      { title: "Never sends twice", detail: "Holds and retries when Google or email fails, then tells you" },
    ],
    install: "docker compose up -d",
    url: "github.com/taufiquebuilds/agencyrecap",
    stars: null,
    accent: "#0f766e",
  };
}

export function validStory2() {
  return {
    version: 2,
    name: "agencyrecap",
    url: "github.com/taufiquebuilds/agencyrecap",
    install: "docker compose up -d",
    accent: "#1f7a4d",
    style: "midnight",
    scenes: [
      { type: "hook", lines: ["40 clients.", "40 reports.", "Every single month."], accentWords: ["single", "month."], count: { line: 0, to: 40 } },
      { type: "title", promise: "Monthly client reports that send themselves" },
      { type: "list", items: ["Branded PDF every month", "Never sends twice", "Free to self-host"] },
      { type: "counter", items: [{ value: 4812, label: "Sessions", note: "up 10%" }] },
      { type: "end" },
    ],
  };
}
