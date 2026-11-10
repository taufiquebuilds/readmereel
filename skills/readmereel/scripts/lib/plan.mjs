import { DEFAULT_ACCENT } from "./story.mjs";

// Film plan: scene timing, transitions, grounds and sound cues. Pure data, no I/O, deterministic.

export const T = 0.35;
// After a scene's last hold: the outgoing transition (T) plus a margin, so nothing is still being read as it leaves.
const EXIT = T + 0.12;
const FRAME = 1 / 30;
const MIN_FILM = 15;
const MAX_FILM = 35;
const KINDS = ["whip", "zoom", "flood", "blur", "carry"];

// Whole frames at 30 fps, then 4 decimals so float noise never reaches the HTML.
const round4 = (v) => Number(v.toFixed(4));
const frame = (x) => round4(Math.round(x * 30) / 30);

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
export const hold = (s) => 0.5 + 0.3 * words(s);

const sum = (n, fn) => {
  let total = 0;
  for (let j = 0; j < n; j++) total += fn(j);
  return total;
};

// ---------- beats and length per scene type (scene-local seconds) ----------

function endTyping(story) {
  return 0.03 * String(story.install ?? "").length;
}

// `entering` is the transition the scene comes in by (null for the first scene, or when not known yet).
export function sceneBeats(scene, story = {}, entering = null) {
  switch (scene.type) {
    case "hook": {
      const lines = scene.lines ?? [];
      return { lineStarts: lines.map((_, k) => sum(k, (j) => T + hold(lines[j]))) };
    }
    case "title":
      // Badge, name, promise. The badge is on screen (half size) from the first frame and the name right after it.
      return { landTimes: [0, 0.05, 0.5] };
    case "ui": {
      const focus = scene.focus ?? [];
      const focusStarts = focus.map((_, k) => 0.8 + sum(k, (j) => 0.6 + hold(focus[j].label ?? "")));
      const focusEnd = 0.8 + sum(focus.length, (j) => 0.6 + hold(focus[j].label ?? ""));
      const stateTimes = (scene.states ?? []).map((st) => st.at);
      const captionAt = Math.max(focusEnd, stateTimes.length ? Math.max(...stateTimes) + 0.5 : 0);
      return { focusStarts, stateTimes, captionAt };
    }
    case "terminal": {
      // Typing starts as the scene enters (the card is on screen from the first frame); under a carry, once the
      // outgoing hero has gone (until then it covers the card, and the typed text would read through it).
      const typeStart = entering === "carry" ? 0.4 : 0.1;
      const typing = Math.min(1.6, 0.05 * String(scene.command ?? "").length);
      return { typeStart, outputStart: typeStart + typing + 0.15 };
    }
    case "counter":
      return { itemStarts: (scene.items ?? []).map((_, k) => 0.35 + 0.12 * k) };
    case "compare":
      return { wipeStart: 0.6 + hold(scene.before?.label) };
    case "list": {
      // Item 0 lands with the scene's entrance (0.35); each next item starts once the previous one has landed and been
      // held, and lands 0.2 s after it starts.
      const items = scene.items ?? [];
      const itemStarts = [];
      let land = 0.35;
      items.forEach((item, k) => {
        if (k === 0) { itemStarts.push(0); return; }
        const start = land + hold(items[k - 1]) + 0.16;
        itemStarts.push(start);
        land = start + 0.2;
      });
      return { itemStarts };
    }
    case "end":
      return { landTimes: [0.1, 0.25, 0.6, 0.75], typeStart: 0.75 };
    default:
      throw new Error(`Unknown scene type: ${scene.type}`);
  }
}

export function sceneLength(scene, story = {}, entering = null) {
  const b = sceneBeats(scene, story, entering);
  switch (scene.type) {
    case "hook": {
      const lines = scene.lines ?? [];
      return b.lineStarts.at(-1) + T + hold(lines.at(-1)) + 0.2;
    }
    case "title":
      // The promise's words blur in 0.07 s apart from 0.8 and each takes 0.16 s; then it holds.
      return 0.8 + 0.07 * Math.max(0, words(scene.promise) - 1) + 0.16 + hold(scene.promise) + EXIT;
    case "ui":
      return b.captionAt + hold(scene.caption ?? "") + 0.35;
    case "terminal": {
      // The output plus 1.8 s, and at least long enough that every highlighted line, once its accent pop has landed
      // (0.6 s after it appears), holds for its words before the exit.
      const out = scene.output ?? [];
      const floor = b.outputStart + 0.075 * out.length + 1.2 + 0.6;
      const reads = (scene.highlight ?? []).filter((k) => out[k] !== undefined).map((k) => b.outputStart + 0.075 * k + 0.6 + hold(out[k]) + EXIT);
      return Math.max(floor, ...reads);
    }
    case "counter": {
      const items = scene.items ?? [];
      const longest = Math.max(...items.map((it) => hold(`${it.label} ${it.note ?? ""}`)));
      // The last item's roll and suffix pop settle 1.08 s after it starts; then the longest label and note hold.
      return b.itemStarts.at(-1) + 1.08 + longest + EXIT;
    }
    case "compare": {
      const after = `${scene.after?.label ?? ""} ${(scene.after?.points ?? []).join(" ")}`;
      return b.wipeStart + 0.8 + hold(after) + 0.2;
    }
    case "list": {
      const items = scene.items ?? [];
      return b.itemStarts[2] + 0.2 + hold(items[2]) + EXIT;
    }
    case "end":
      return Math.max(0.75 + endTyping(story) + 2.5, 3.2);
    default:
      throw new Error(`Unknown scene type: ${scene.type}`);
  }
}

// ---------- grounds ----------

export function GROUNDS(style = "midnight", accent = DEFAULT_ACCENT) {
  const dark = "#08090b";
  const light = "#e9edf1";
  const types = ["hook", "title", "ui", "terminal", "counter", "compare", "list", "end"];
  const product = new Set(["ui", "compare"]);
  const out = {};
  for (const type of types) {
    if (style === "paper") out[type] = product.has(type) ? light : "#f6f5f1";
    else if (style === "signal") out[type] = product.has(type) ? light : ["hook", "list", "end"].includes(type) ? accent : dark;
    else out[type] = product.has(type) ? light : dark;
  }
  return out;
}

// ---------- transitions ----------

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function allowedAt(scenes, grounds, i) {
  const type = scenes[i].type;
  const list = ["whip", "blur"];
  if (["ui", "counter", "title"].includes(type)) list.push("zoom");
  if (["ui", "compare"].includes(type)) list.push("carry");
  if (grounds[type] !== grounds[scenes[i + 1].type]) list.push("flood");
  return list;
}

// One greedy pass. Returns null when it paints itself into a corner (nothing allowed at a boundary).
function pass(scenes, grounds, seed, blurCap) {
  const rand = mulberry32(fnv1a(seed));
  const kinds = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    let allowed = allowedAt(scenes, grounds, i).filter((k) => k !== kinds[i - 1]);
    if (kinds.filter((k) => k === "blur").length >= blurCap) allowed = allowed.filter((k) => k !== "blur");
    if (!allowed.length) return null;
    const used = new Set(kinds);
    const fresh = allowed.filter((k) => !used.has(k));
    const pool = used.size < KINDS.length && fresh.length ? fresh : allowed;
    kinds.push(pool[Math.floor(rand() * pool.length)]);
  }
  return kinds;
}

function distinctOk(kinds) {
  return kinds.length < 4 || new Set(kinds).size >= 3;
}

// Exhaustive fallback in a fixed order: first sequence meeting every rule.
function search(scenes, grounds, blurCap) {
  const m = scenes.length - 1;
  const kinds = [];
  const go = (i) => {
    if (i === m) return distinctOk(kinds);
    for (const k of allowedAt(scenes, grounds, i)) {
      if (k === kinds[i - 1]) continue;
      if (k === "blur" && kinds.filter((x) => x === "blur").length >= blurCap) continue;
      kinds.push(k);
      if (go(i + 1)) return true;
      kinds.pop();
    }
    return false;
  };
  return go(0) ? kinds : null;
}

export function pickTransitions(scenes, grounds, seed) {
  const m = scenes.length - 1;
  if (m <= 0) return [];
  const blurCap = Math.ceil(m / 3);
  let best = null;
  for (let attempt = 0; attempt <= 200; attempt++) {
    const kinds = pass(scenes, grounds, attempt === 0 ? seed : `${seed}#${attempt}`, blurCap);
    if (!kinds) continue;
    if (distinctOk(kinds)) return kinds;
    best ??= kinds;
  }
  return search(scenes, grounds, blurCap) ?? best ?? search(scenes, grounds, Infinity) ?? [];
}

// ---------- film ----------

export function planFilm(story) {
  const scenes = story.scenes;
  const n = scenes.length;
  const style = story.style ?? "midnight";
  const accent = story.accent ?? DEFAULT_ACCENT;
  const grounds = GROUNDS(style, accent);
  // Transitions first: a scene's beats (and so its length) can depend on how it enters.
  const kinds = pickTransitions(scenes, grounds, JSON.stringify(scenes));
  const entering = (i) => (i === 0 ? null : kinds[i - 1]);
  let lengths = scenes.map((scene, i) => sceneLength(scene, story, entering(i)));
  const raw = lengths.reduce((a, b) => a + b, 0) - T * (n - 1);
  if (raw > MAX_FILM) {
    let longest = 0;
    lengths.forEach((len, i) => { if (len > lengths[longest]) longest = i; });
    throw new Error(`Too much to read in 35 s: remove a scene or shorten text in scenes[${longest}] (${scenes[longest].type})`);
  }
  if (raw < MIN_FILM) {
    const extra = (MIN_FILM - raw) / n;
    lengths = lengths.map((len) => len + extra);
  }

  const planned = [];
  let start = 0;
  scenes.forEach((scene, i) => {
    const { type, ...fields } = scene;
    const data = { ...fields, accent, style };
    if (type === "title" || type === "end") {
      Object.assign(data, { name: story.name, install: story.install, url: story.url, logo: story.logo, endCard: story.endCard });
    }
    const len = frame(lengths[i]);
    planned.push({
      id: `s${i + 1}`,
      index: i,
      type,
      start,
      duration: len,
      in: i === 0 ? null : kinds[i - 1],
      out: i === n - 1 ? null : kinds[i],
      ground: grounds[type],
      prevGround: i === 0 ? null : grounds[scenes[i - 1].type],
      nextGround: i === n - 1 ? null : grounds[scenes[i + 1].type],
      beats: sceneBeats(scene, story, entering(i)),
      data,
    });
    // Each start comes from the rounded previous scene, so rounding error never compounds.
    start = frame(start + len - T);
  });
  const last = planned.at(-1);
  // Rounding can leave a stretched film a frame short of the minimum: add frames to the last scene until it fits.
  while (round4(last.start + last.duration) < MIN_FILM) last.duration = frame(last.duration + FRAME);
  const duration = round4(last.start + last.duration);

  const cues = [];
  let whooshes = 0;
  for (const s of planned) {
    const add = (t, sound) => cues.push({ t: frame(s.start + t + FRAME), sound });
    if (["whip", "zoom", "carry"].includes(s.in)) add(0, whooshes++ % 2 === 0 ? "whoosh" : "whoosh-short");
    if (s.type === "ui") {
      s.beats.focusStarts.forEach((f) => add(f + 0.6, "click-soft"));
      s.beats.stateTimes.forEach((t, k) => add(t, k % 2 === 0 ? "pop" : "click-soft"));
    } else if (s.type === "counter") {
      s.beats.itemStarts.forEach((f) => add(f + 1.0, "pop"));
    } else if (s.type === "terminal") {
      add(s.beats.typeStart, "key-press");
    } else if (s.type === "end") {
      add(0.1, "impact-bass-1");
      add(0.75, "key-press");
    }
  }
  const sorted = cues.sort((a, b) => a.t - b.t);
  return { duration, scenes: planned, cues: sorted };
}
