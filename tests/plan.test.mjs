import { test } from "node:test";
import assert from "node:assert/strict";
import { hold, pickTransitions, planFilm, sceneBeats, sceneLength, T } from "../skills/readmereel/scripts/lib/plan.mjs";
import { validStory2 } from "./helpers.mjs";

const FRAME = 1 / 30;

test("hold follows the readability rule", () => {
  assert.equal(hold("Sent. By itself."), 0.5 + 0.3 * 3);
});

test("film length is clamped to 15–35 s and scenes overlap by T", () => {
  const p = planFilm(validStory2());
  assert.ok(p.duration >= 15 && p.duration <= 35, `duration ${p.duration}`);
  for (let i = 1; i < p.scenes.length; i++) {
    const prev = p.scenes[i - 1];
    assert.ok(Math.abs(p.scenes[i].start - (prev.start + prev.duration - T)) < FRAME + 1e-9);
  }
  const last = p.scenes.at(-1);
  assert.ok(Math.abs(last.start + last.duration - p.duration) < 1e-9);
});

test("a story that cannot fit in 35 s names a scene", () => {
  const s = validStory2();
  const long = "one two three four five six";
  const counter = { type: "counter", items: [1, 2, 3].map((v) => ({ value: v, label: "four word label here", note: "and a four word note" })) };
  s.scenes = [
    { type: "hook", lines: ["One two three four", "Five six seven eight", "Nine ten eleven twelve"] },
    { type: "title", promise: "one two three four five six seven eight nine ten" },
    { type: "list", items: [long, long, long] },
    { type: "list", items: [long, long, long] },
    counter,
    counter,
    { type: "terminal", command: "npm test", output: ["ok"] },
    { type: "end" },
  ];
  assert.throws(() => planFilm(s), /Too much to read in 35 s: remove a scene or shorten text in scenes\[2\] \(list\)/);
});

function randomScenes(rand) {
  const middle = ["title", "ui", "terminal", "counter", "compare", "list"];
  const n = 5 + Math.floor(rand() * 4);
  const scenes = [{ type: "hook" }];
  while (scenes.length < n - 1) {
    const t = middle[Math.floor(rand() * middle.length)];
    if (t === "title" && scenes.some((x) => x.type === "title")) continue;
    if (scenes.filter((x) => x.type === t).length >= 2) continue;
    scenes.push({ type: t });
  }
  scenes.push({ type: "end" });
  return scenes;
}

test("transition rules hold for 1,000 random films", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const grounds = { hook: "#08090b", title: "#08090b", ui: "#e9edf1", terminal: "#08090b", counter: "#08090b", compare: "#e9edf1", list: "#08090b", end: "#08090b" };
  for (let k = 0; k < 1000; k++) {
    const scenes = randomScenes(rand);
    const kinds = pickTransitions(scenes, grounds, `seed-${k}`);
    assert.equal(kinds.length, scenes.length - 1);
    for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1], `repeat at ${i}`);
    if (kinds.length >= 4) {
      const distinct = new Set(kinds).size;
      // Films made only of hook/list/terminal scenes offer nothing but whip and blur (no zoom, carry or flood),
      // and "never the same kind twice" then leaves 2 kinds at most: the 3-kind rule cannot apply to them.
      const outgoing = scenes.slice(0, -1);
      const reachable = new Set(["whip", "blur"]);
      outgoing.forEach((sc, i) => {
        if (["ui", "counter", "title"].includes(sc.type)) reachable.add("zoom");
        if (["ui", "compare"].includes(sc.type)) reachable.add("carry");
        if (grounds[sc.type] !== grounds[scenes[i + 1].type]) reachable.add("flood");
      });
      assert.ok(distinct >= Math.min(3, reachable.size) && distinct <= 5, `distinct ${distinct}`);
    }
    assert.ok(kinds.filter((x) => x === "blur").length <= Math.ceil(kinds.length / 3));
    kinds.forEach((kind, i) => {
      if (kind === "zoom") assert.ok(["ui", "counter", "title"].includes(scenes[i].type));
      if (kind === "carry") assert.ok(["ui", "compare"].includes(scenes[i].type));
      if (kind === "flood") assert.notEqual(grounds[scenes[i].type], grounds[scenes[i + 1].type]);
    });
    assert.deepEqual(pickTransitions(scenes, grounds, `seed-${k}`), kinds, "deterministic");
  }
});

test("cues follow transitions and actions", () => {
  const p = planFilm(validStory2());
  const whooshes = p.cues.filter((c) => c.sound.startsWith("whoosh"));
  const moving = p.scenes.slice(1).filter((s) => ["whip", "zoom", "carry"].includes(s.in));
  assert.equal(whooshes.length, moving.length);
  for (let i = 1; i < whooshes.length; i++) assert.notEqual(whooshes[i].sound, whooshes[i - 1].sound, "takes rotate");
  assert.ok(p.cues.some((c) => c.sound === "impact-bass-1"), "end card impact");
});

test("sceneLength grows with text", () => {
  const story = validStory2();
  assert.ok(sceneLength({ type: "list", items: ["a b c d e f", "g", "h"] }, story) > sceneLength({ type: "list", items: ["a", "g", "h"] }, story));
});

// Every timing a film hands to HTML: scene starts and durations, film duration and cue times.
function timings(p) {
  return [...p.scenes.flatMap((s) => [s.start, s.duration]), p.duration, ...p.cues.map((c) => c.t)];
}

// 4 decimals cannot hold every 1/30 s frame exactly, so each value must sit within 0.0001 s of a whole frame
// (the film duration is a sum of two such values, which can drift that far).
function assertFrameClean(values) {
  for (const v of values) {
    assert.equal(Number(v.toFixed(4)), v, `${v} has more than 4 decimals`);
    assert.ok(Math.abs(v - Math.round(v * 30) / 30) < 0.0001 + 1e-9, `${v} is not on a whole frame at 30 fps`);
  }
}

test("every start, duration and cue time is a whole frame with at most 4 decimals", () => {
  assertFrameClean(timings(planFilm(validStory2())));
});

test("a short story stretched to 15 s keeps the invariants and ends at 15 s or later", () => {
  const s = validStory2();
  // This install length makes rounding leave the stretched film just under 15 s, so the last scene must be bumped.
  s.install = "npm i -g readmereel";
  s.scenes = [
    { type: "hook", lines: ["Hi"] },
    { type: "title", promise: "Hi" },
    { type: "list", items: ["Hi", "Hi", "Hi"] },
    { type: "counter", items: [{ value: 1, label: "Hi" }] },
    { type: "end" },
  ];
  const raw = s.scenes.reduce((a, sc) => a + sceneLength(sc, s), 0) - T * (s.scenes.length - 1);
  assert.ok(raw < 15, `raw ${raw} must need the stretch path`);
  const p = planFilm(s);
  assert.ok(p.duration >= 15, `duration ${p.duration}`);
  assertFrameClean(timings(p));
  for (let i = 1; i < p.scenes.length; i++) {
    const prev = p.scenes[i - 1];
    assert.ok(Math.abs(p.scenes[i].start - (prev.start + prev.duration - T)) < FRAME + 1e-9);
  }
  const last = p.scenes.at(-1);
  assert.ok(Math.abs(last.start + last.duration - p.duration) < 1e-9);
});

// Readability margins: holds are measured from when things land, and every scene keeps EXIT = T + 0.12 after its
// last hold for the outgoing transition.
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ""} ${a} != ${b}`);

test("list items wait for the previous item to land and hold, and the scene ends a hold after the last lands", () => {
  const scene = { type: "list", items: ["one two", "three", "four five six"] };
  const { itemStarts } = sceneBeats(scene, validStory2());
  // land0 = 0.35; start(k) = land(k-1) + hold(k-1) + 0.16; land(k) = start(k) + 0.2
  near(itemStarts[0], 0);
  near(itemStarts[1], 0.35 + hold("one two") + 0.16, "start 1");
  near(itemStarts[2], itemStarts[1] + 0.2 + hold("three") + 0.16, "start 2");
  near(sceneLength(scene, validStory2()), itemStarts[2] + 0.2 + hold("four five six") + T + 0.12, "length");
});

test("a counter holds its longest label and note after the last item settles", () => {
  const scene = { type: "counter", items: [{ value: 1, label: "Sessions", note: "up 10%" }, { value: 2, label: "Key events" }] };
  const { itemStarts } = sceneBeats(scene, validStory2());
  near(sceneLength(scene, validStory2()), itemStarts.at(-1) + 1.08 + hold("Sessions up 10%") + T + 0.12);
});

test("the title badge is on screen from the first frame and the promise holds after its last word lands", () => {
  const scene = { type: "title", promise: "Monthly client reports that send themselves" };
  assert.deepEqual(sceneBeats(scene, validStory2()).landTimes, [0, 0.05, 0.5]);
  near(sceneLength(scene, validStory2()), 0.8 + 0.07 * 5 + 0.16 + hold(scene.promise) + T + 0.12);
});

test("each scene knows the ground it enters from", () => {
  const p = planFilm(validStory2());
  assert.equal(p.scenes[0].prevGround, null);
  for (let i = 1; i < p.scenes.length; i++) assert.equal(p.scenes[i].prevGround, p.scenes[i - 1].ground);
});
