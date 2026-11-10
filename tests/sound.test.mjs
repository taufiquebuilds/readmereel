import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { planFilm } from "../skills/readmereel/scripts/lib/plan.mjs";
import { MUSIC_FEEL, MUSIC_SKIPPED, musicTag, parseResolve, resolveEffects, resolveMusic, SOUNDS } from "../skills/readmereel/scripts/lib/sound.mjs";
import { tmpDir } from "./helpers.mjs";

const fixture = (name) => readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");

// Fake `npx hyperframes media-use resolve`: writes a file under <project>/.media like the real tool and prints real-shaped JSON.
function fakeRun({ failing = [], calls = [] } = {}) {
  return (cmd, args) => {
    calls.push(args);
    const get = (flag) => args[args.indexOf(flag) + 1];
    const intent = get("--intent");
    const project = get("--project");
    if (failing.includes(intent)) return { status: 1, stdout: fixture("media-use-resolve-bgm-missing.json") + '{"ok":false}\n', stderr: "boom" };
    const rel = `.media/audio/${get("--type")}/${intent}.mp3`;
    mkdirSync(join(project, ".media/audio", get("--type")), { recursive: true });
    writeFileSync(join(project, rel), `audio:${intent}`);
    const json = { ...JSON.parse(fixture("media-use-resolve-sfx.json")), path: rel };
    return { status: 0, stdout: `${JSON.stringify(json)}\n`, stderr: "media-use: note\n" };
  };
}

test("parses the real media-use JSON shape", () => {
  const json = parseResolve(`some noise\n${fixture("media-use-resolve-sfx.json")}`);
  assert.equal(json.ok, true);
  assert.equal(json.path, ".media/audio/sfx/sfx_001.mp3");
  assert.equal(parseResolve("nothing"), undefined);
});

test("resolves every effect once with --local-only and names the files <sound>.mp3", () => {
  const dir = tmpDir();
  const calls = [];
  const sfx = resolveEffects(dir, { run: fakeRun({ calls }), warn: () => assert.fail("no warning expected") });
  assert.equal(calls.length, SOUNDS.length);
  for (const [i, sound] of SOUNDS.entries()) {
    assert.deepEqual(calls[i].slice(2), ["media-use", "resolve", "--type", "sfx", "--intent", sound, "--local-only", "--project", dir, "--json"]);
    assert.equal(readFileSync(join(sfx, `${sound}.mp3`), "utf8"), `audio:${sound}`);
  }
  assert.match(readFileSync(join(sfx, "CREDITS.md"), "utf8"), /Pixabay/);
});

test("a sound that cannot be resolved is skipped and reported", () => {
  const warnings = [];
  const sfx = resolveEffects(tmpDir(), { run: fakeRun({ failing: ["pop"] }), warn: (m) => warnings.push(m) });
  assert.ok(!existsSync(join(sfx, "pop.mp3")));
  assert.ok(existsSync(join(sfx, "whoosh.mp3")));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /"pop" skipped/);
});

test("musicTag fades in over 1 s and out over the last 2 s on track 99 (the lane scales data-volume 0.35)", () => {
  const tag = musicTag("assets/music.mp3", 20);
  assert.match(tag, /data-track-index="99"/);
  assert.match(tag, /data-volume="0.35"/);
  const lane = JSON.parse(/data-automation='([^']+)'/.exec(tag)[1]).lanes[0];
  assert.equal(lane.target, "volume");
  assert.deepEqual(lane.points, [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 18, v: 1 }, { t: 20, v: 0 }]);
});

test("music: null gives null; a file is copied; heygen failure logs the message", () => {
  const dir = tmpDir();
  assert.equal(resolveMusic({ music: null }, dir, { run: () => assert.fail("not called") }), null);
  const base = tmpDir();
  writeFileSync(join(base, "bed.mp3"), "bed");
  const copied = resolveMusic({ music: "bed.mp3" }, dir, { baseDir: base });
  assert.equal(readFileSync(copied, "utf8"), "bed");
  const warnings = [];
  const calls = [];
  const run = (cmd, args) => (calls.push(args), { status: 1, stdout: fixture("media-use-resolve-bgm-missing.json"), stderr: "" });
  assert.equal(resolveMusic({ music: "heygen" }, dir, { run, warn: (m) => warnings.push(m) }), null);
  assert.deepEqual(warnings, [MUSIC_SKIPPED]);
  assert.equal(MUSIC_SKIPPED, "Music skipped: sign in to HeyGen (heygen auth login --oauth) or give a music file.");
  assert.deepEqual(calls[0].slice(2), ["media-use", "resolve", "--type", "bgm", "--intent", MUSIC_FEEL, "--project", dir, "--json"]);
});

test("buildProject places the music file as one track-99 tag", () => {
  const story = { version: 2, name: "x", url: "github.com/a/b", style: "midnight", accent: "#1f7a4d", scenes: [{ type: "hook", lines: ["One", "Two"] }, { type: "end" }] };
  const plan = planFilm(story);
  const bed = join(tmpDir(), "bed.mp3");
  writeFileSync(bed, "bed");
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan, music: bed });
  const html = readFileSync(join(dir, "index.html"), "utf8");
  assert.equal((html.match(/<audio id="music"/g) ?? []).length, 1);
  assert.ok(html.includes('src="assets/music.mp3"'));
  assert.equal(readFileSync(join(dir, "assets/music.mp3"), "utf8"), "bed");
});
