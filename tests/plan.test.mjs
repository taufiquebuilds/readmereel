import { test } from "node:test";
import assert from "node:assert/strict";
import { hold, pickTransitions, planFilm, sceneLength, T } from "../skills/readmereel/scripts/lib/plan.mjs";
import { validStory2 } from "./helpers.mjs";

test("hold follows the readability rule", () => {
  assert.equal(hold("Sent. By itself."), 0.5 + 0.3 * 3);
});

test("film length is clamped to 15–35 s and scenes overlap by T", () => {
  const p = planFilm(validStory2());
  assert.ok(p.duration >= 15 && p.duration <= 35, `duration ${p.duration}`);
  for (let i = 1; i < p.scenes.length; i++) {
    const prev = p.scenes[i - 1];
    assert.ok(Math.abs(p.scenes[i].start - (prev.start + prev.duration - T)) < 1e-9);
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
