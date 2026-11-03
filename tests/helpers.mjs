import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tmpDir() {
  return mkdtempSync(join(tmpdir(), "readmereel-"));
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
