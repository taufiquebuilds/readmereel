import { closeSync, constants, existsSync, fstatSync, openSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const V1_LIMITS = { name: 24, promise: 60, problem: 70, featureTitle: 40, featureDetail: 80, install: 48, url: 60 };
const V2_LIMITS = {
  name: 24, url: 60, install: 48, hookLine: 22, hookWords: 4, promise: 60, label: 28, caption: 32,
  command: 48, outputLine: 64, counterLabel: 20, suffix: 3, note: 24, sideLabel: 24, point: 40, listItem: 32,
};
// v1 keys stay available so the v1 build/render path and its tests keep working until they are replaced.
export const LIMITS = { ...V1_LIMITS, ...V2_LIMITS };
export const STYLES = ["midnight", "paper", "signal"];
export const SCENE_TYPES = ["hook", "title", "ui", "terminal", "counter", "compare", "list", "end"];
export const DEFAULT_ACCENT = "#22c55e";

const V1_KNOWN = ["name", "promise", "problem", "features", "install", "url", "stars", "logo", "accent", "music", "endCard"];
const V2_KNOWN = ["version", "name", "url", "install", "accent", "style", "logo", "music", "sfx", "endCard", "scenes"];
const SCENE_KEYS = {
  hook: ["lines", "accentWords", "count"],
  title: ["promise"],
  ui: ["image", "html", "focus", "states", "caption"],
  terminal: ["command", "output", "highlight"],
  counter: ["items"],
  compare: ["before", "after"],
  list: ["items"],
  end: [],
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_LIKE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;
const LOGO = /\.(png|svg)$/i;
const AUDIO = /\.(mp3|m4a|wav|ogg)$/i;
const HTML = /\.html?$/i;
const PLACEHOLDER = /<[^>]+>/;
const MIN_STATE_GAP = 0.4;
// A state's class: one plain class name, and not one the scene templates or the runtime use (the sanitizer removes
// those from screens for the same reason).
const STATE_CLASS = (c) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(c)
  && !["root", "scene-data", "clip", "hero", "cam", "ground"].includes(c.toLowerCase())
  && !/^(?:hook|title|ui|terminal|counter|compare|list|end|zoom|screen)-/i.test(c);

function text(errors, label, value, max) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${label}: required text`);
  else if (/[\r\n]/.test(value)) errors.push(`${label}: must be one line`);
  else if (value.length > max) errors.push(`${label}: ${value.length} characters, the limit is ${max}`);
}

function file(errors, label, value, baseDir, pattern, kind) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !pattern.test(value)) {
    errors.push(`${label}: must be a path to ${kind} file`);
  } else if (!existsSync(resolve(baseDir, value))) {
    errors.push(`${label}: file not found: ${value}`);
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const wordsOf = (s) => s.trim().split(/\s+/).filter(Boolean);

function checkUrl(errors, url) {
  if (typeof url !== "string" || !URL_LIKE.test(url)) errors.push("url: must be a web address like github.com/you/repo");
  else if (/\.git$/i.test(url)) errors.push("url: drop the .git ending");
  else if (url.length > LIMITS.url) errors.push(`url: ${url.length} characters, the limit is ${LIMITS.url}`);
}

// ---------- v1 ----------

function validateV1(story, baseDir) {
  const errors = [];
  for (const key of Object.keys(story)) if (!V1_KNOWN.includes(key)) errors.push(`${key}: unknown field`);
  text(errors, "name", story.name, V1_LIMITS.name);
  text(errors, "promise", story.promise, V1_LIMITS.promise);
  text(errors, "problem", story.problem, V1_LIMITS.problem);
  if (!Array.isArray(story.features) || story.features.length !== 3) {
    errors.push("features: must be a list of exactly 3");
  } else {
    story.features.forEach((f, i) => {
      const label = `features[${i + 1}]`;
      if (f === null || typeof f !== "object") return errors.push(`${label}: must be an object`);
      text(errors, `${label}.title`, f.title, V1_LIMITS.featureTitle);
      text(errors, `${label}.detail`, f.detail, V1_LIMITS.featureDetail);
      file(errors, `${label}.image`, f.image, baseDir, IMAGE, "an image (png, jpg, gif, svg, webp)");
    });
  }
  text(errors, "install", story.install, V1_LIMITS.install);
  checkUrl(errors, story.url);
  if (story.stars !== undefined && story.stars !== null && !(Number.isInteger(story.stars) && story.stars >= 0)) {
    errors.push("stars: must be a whole number or null");
  }
  file(errors, "logo", story.logo, baseDir, LOGO, "a PNG or SVG");
  if (story.accent !== undefined && !(typeof story.accent === "string" && HEX.test(story.accent))) {
    errors.push("accent: must be a hex colour like #0f766e");
  }
  file(errors, "music", story.music, baseDir, AUDIO, "an audio (mp3, m4a, wav, ogg)");
  if (story.endCard !== undefined && typeof story.endCard !== "boolean") errors.push("endCard: must be true or false");
  return errors;
}

export function isV1(story) {
  return isObject(story) && story.version === undefined && story.scenes === undefined;
}

// ---------- v1 -> v2 conversion ----------

function shorten(value, max) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  if (space > max / 2) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,;:.\-]+$/, "")}…`;
}

function splitHook(problem) {
  const lines = [];
  let line = [];
  for (const raw of wordsOf(String(problem ?? ""))) {
    const word = raw.slice(0, LIMITS.hookLine);
    const next = [...line, word];
    if (line.length && (next.length > LIMITS.hookWords || next.join(" ").length > LIMITS.hookLine)) {
      lines.push(line.join(" "));
      if (lines.length === 3) return lines;
      line = [word];
    } else {
      line = next;
    }
  }
  if (line.length) lines.push(line.join(" "));
  return lines.slice(0, 3);
}

const DEFAULT_SIZE = [1600, 1000];
// Larger files are not looked at (the default box is used).
const IMAGE_SIZE_MAX_BYTES = 25 * 1024 * 1024;
const SOF = (m) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

// Width and height from a PNG, JPEG, GIF, WebP or SVG header, or the default box. Only a plain file is read (no FIFO, device or
// directory, no file with other hard links, nothing over 25 MB), only when its real path is inside baseDir (when one is
// given, so a symlink cannot point out of the story folder), and only the header bytes it needs.
export function imageSize(path, baseDir) {
  let fd;
  try {
    const real = realpathSync(path);
    if (baseDir !== undefined) {
      const rel = relative(realpathSync(baseDir), real);
      if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return DEFAULT_SIZE;
    }
    fd = openSync(real, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > IMAGE_SIZE_MAX_BYTES) return DEFAULT_SIZE;
    const read = (pos, len) => {
      const b = Buffer.alloc(len);
      return b.subarray(0, readSync(fd, b, 0, len, pos));
    };
    const head = read(0, 4096);
    if (head.length > 24 && head.readUInt32BE(0) === 0x89504e47 && head.toString("latin1", 12, 16) === "IHDR") {
      return [head.readUInt32BE(16), head.readUInt32BE(20)];
    }
    if (head.length > 4 && head[0] === 0xff && head[1] === 0xd8) {
      // Walk the segments, reading 9 bytes per marker, until a start-of-frame marker.
      let i = 2;
      for (let steps = 0; steps < 100000 && i + 9 <= stat.size; steps++) {
        const m = read(i, 9);
        if (m.length < 9) break;
        if (m[0] !== 0xff) { const k = m.indexOf(0xff, 1); i += k < 0 ? 9 : k; continue; }
        if (m[1] === 0xff) { i += 1; continue; }
        if (SOF(m[1])) return [m.readUInt16BE(7), m.readUInt16BE(5)];
        i += 2 + m.readUInt16BE(2);
      }
    }
    if (head.length >= 10 && head.toString("latin1", 0, 4) === "GIF8") return [head.readUInt16LE(6), head.readUInt16LE(8)];
    if (head.length >= 16 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WEBP") {
      const chunk = head.toString("latin1", 12, 16);
      if (chunk === "VP8X" && head.length >= 30) return [1 + head.readUIntLE(24, 3), 1 + head.readUIntLE(27, 3)];
      if (chunk === "VP8 " && head.length >= 30) return [head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff];
      if (chunk === "VP8L" && head.length >= 25 && head[20] === 0x2f) {
        const bits = head.readUInt32LE(21);
        return [1 + (bits & 0x3fff), 1 + ((bits >>> 14) & 0x3fff)];
      }
    }
    const svg = head.toString("utf8").match(/<svg\b[^>]*>/i)?.[0];
    if (svg) {
      const attr = (name) => svg.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(?:px)?\\s*["']`, "i"))?.[1];
      const w = Number(attr("width"));
      const h = Number(attr("height"));
      if (w > 0 && h > 0) return [Math.round(w), Math.round(h)];
      const vb = svg.match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().split(/[\s,]+/).map(Number);
      if (vb?.length === 4 && vb[2] > 0 && vb[3] > 0) return [Math.round(vb[2]), Math.round(vb[3])];
    }
  } catch {
    // unreadable or unknown format: fall through to the default
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  return DEFAULT_SIZE;
}

export function toV2(story, baseDir = process.cwd()) {
  if (!isV1(story)) return story;
  const features = Array.isArray(story.features) ? story.features.filter((f) => f && typeof f === "object") : [];
  const uiFeatures = features.filter((f) => f.image).slice(0, 2);
  const rest = features.filter((f) => !uiFeatures.includes(f));
  const ui = uiFeatures.map((f) => {
    const [w, h] = imageSize(resolve(baseDir, f.image), baseDir);
    return {
      type: "ui",
      image: f.image,
      focus: [{ box: [0, 0, w, h], label: shorten(f.title, LIMITS.label) }],
      caption: shorten(f.detail, LIMITS.caption),
    };
  });
  const titles = [...rest, ...uiFeatures].map((f) => shorten(f.title, LIMITS.listItem)).slice(0, 3);
  const scenes = [
    { type: "hook", lines: splitHook(story.problem) },
    { type: "title", promise: story.promise },
    ...ui,
    { type: "list", items: titles },
  ];
  if (scenes.length + 1 < 5) {
    scenes.push({ type: "list", items: features.slice(0, 3).map((f) => shorten(f.detail, LIMITS.listItem)) });
  }
  scenes.push({ type: "end" });
  const out = { version: 2, name: story.name, url: story.url, install: story.install };
  if (story.accent !== undefined) out.accent = story.accent;
  if (story.logo !== undefined) out.logo = story.logo;
  return {
    ...out,
    music: story.music ?? null,
    sfx: true,
    endCard: story.endCard ?? true,
    style: "midnight",
    scenes,
  };
}

// ---------- v2 ----------

function checkBox(errors, label, box) {
  const ok = Array.isArray(box) && box.length === 4 && box.every((n) => typeof n === "number" && Number.isFinite(n))
    && box[2] > 0 && box[3] > 0;
  if (!ok) errors.push(`${label}: must be [x, y, width, height] in pixels`);
}

function checkItemList(errors, label, items, count, max) {
  if (!Array.isArray(items) || items.length !== count) return errors.push(`${label}: exactly ${count} items`);
  items.forEach((item, i) => text(errors, `${label}[${i}]`, item, max));
}

function validateHook(errors, at, scene) {
  const lines = scene.lines;
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 3) {
    errors.push(`${at}.lines: 1 to 3 lines`);
    return;
  }
  lines.forEach((line, i) => {
    text(errors, `${at}.lines[${i}]`, line, LIMITS.hookLine);
    if (typeof line === "string" && wordsOf(line).length > LIMITS.hookWords) errors.push(`${at}.lines[${i}]: at most ${LIMITS.hookWords} words`);
  });
  if (scene.accentWords !== undefined) {
    if (!Array.isArray(scene.accentWords)) errors.push(`${at}.accentWords: must be a list of words`);
    else {
      const present = new Set(lines.filter((l) => typeof l === "string").flatMap(wordsOf));
      scene.accentWords.forEach((w, i) => {
        if (typeof w !== "string" || !present.has(w)) errors.push(`${at}.accentWords[${i}]: must be a word that appears in lines`);
      });
    }
  }
  if (scene.count !== undefined) {
    const c = scene.count;
    if (!isObject(c)) return errors.push(`${at}.count: must be { line, to }`);
    for (const key of Object.keys(c)) if (!["line", "to"].includes(key)) errors.push(`${at}.count.${key}: unknown field`);
    if (!Number.isInteger(c.to) || c.to < 1) errors.push(`${at}.count.to: must be a whole number of 1 or more`);
    if (!Number.isInteger(c.line) || c.line < 0 || c.line >= lines.length) {
      errors.push(`${at}.count.line: must be a line number from 0 to ${lines.length - 1}`);
    } else if (Number.isInteger(c.to) && typeof lines[c.line] === "string" && !lines[c.line].includes(String(c.to))) {
      errors.push(`${at}.count: line ${c.line} must contain the number ${c.to}`);
    }
  }
}

function validateUi(errors, at, scene, baseDir) {
  const hasImage = scene.image !== undefined && scene.image !== null && scene.image !== "";
  const hasHtml = scene.html !== undefined && scene.html !== null && scene.html !== "";
  if (hasImage === hasHtml) errors.push(`${at}: give either image or html`);
  if (hasImage) file(errors, `${at}.image`, scene.image, baseDir, IMAGE, "an image (png, jpg, gif, svg, webp)");
  if (hasHtml) file(errors, `${at}.html`, scene.html, baseDir, HTML, "an HTML");
  if (!Array.isArray(scene.focus) || scene.focus.length < 1 || scene.focus.length > 3) {
    errors.push(`${at}.focus: 1 to 3 boxes`);
  } else {
    scene.focus.forEach((f, i) => {
      const label = `${at}.focus[${i}]`;
      if (!isObject(f)) return errors.push(`${label}: must be an object`);
      for (const key of Object.keys(f)) if (!["box", "label"].includes(key)) errors.push(`${label}.${key}: unknown field`);
      checkBox(errors, `${label}.box`, f.box);
      if (f.label !== undefined) text(errors, `${label}.label`, f.label, LIMITS.label);
    });
  }
  if (scene.caption !== undefined) text(errors, `${at}.caption`, scene.caption, LIMITS.caption);
  if (scene.states !== undefined) {
    if (!hasHtml) errors.push(`${at}.states: only works with html`);
    else if (!Array.isArray(scene.states) || scene.states.length > 8) errors.push(`${at}.states: at most 8 states`);
    else {
      scene.states.forEach((st, i) => {
        const label = `${at}.states[${i}]`;
        if (!isObject(st)) return errors.push(`${label}: must be an object`);
        for (const key of Object.keys(st)) if (!["at", "selector", "set"].includes(key)) errors.push(`${label}.${key}: unknown field`);
        text(errors, `${label}.selector`, st.selector, 200);
        text(errors, `${label}.set`, st.set, 40);
        if (typeof st.set === "string" && st.set.trim() !== "" && !STATE_CLASS(st.set)) {
          errors.push(`${label}.set: must be a class name (letters, digits, - and _) that the template does not use`);
        }
        if (typeof st.at !== "number" || !Number.isFinite(st.at) || st.at < 0) errors.push(`${label}.at: must be a time in seconds`);
        else if (i > 0 && typeof scene.states[i - 1]?.at === "number" && st.at - scene.states[i - 1].at < MIN_STATE_GAP - 1e-9) {
          errors.push(`${label}.at: states must be at least ${MIN_STATE_GAP} s apart`);
        }
      });
    }
  }
}

function validateTerminal(errors, at, scene) {
  text(errors, `${at}.command`, scene.command, LIMITS.command);
  const out = scene.output;
  if (!Array.isArray(out) || out.length < 1 || out.length > 12) errors.push(`${at}.output: 1 to 12 lines`);
  else out.forEach((line, i) => text(errors, `${at}.output[${i}]`, line, LIMITS.outputLine));
  if (scene.highlight !== undefined) {
    const n = Array.isArray(out) ? out.length : 0;
    if (!Array.isArray(scene.highlight)) errors.push(`${at}.highlight: must be a list of line numbers`);
    else scene.highlight.forEach((h, i) => {
      if (!Number.isInteger(h) || h < 0 || h >= n) errors.push(`${at}.highlight[${i}]: must be a line number from 0 to ${Math.max(n - 1, 0)}`);
    });
  }
}

function validateCounter(errors, at, scene) {
  if (!Array.isArray(scene.items) || scene.items.length < 1 || scene.items.length > 3) {
    errors.push(`${at}.items: 1 to 3 items`);
    return;
  }
  scene.items.forEach((item, i) => {
    const label = `${at}.items[${i}]`;
    if (!isObject(item)) return errors.push(`${label}: must be an object`);
    for (const key of Object.keys(item)) if (!["value", "label", "suffix", "note"].includes(key)) errors.push(`${label}.${key}: unknown field`);
    const v = item.value;
    if (typeof v !== "number" || !Number.isFinite(v)) errors.push(`${label}.value: must be a real number`);
    else if (Math.abs(v) > 9999999 || Math.round(v * 10) / 10 !== v) {
      errors.push(`${label}.value: use a whole number up to 9,999,999 or one with a single decimal place`);
    }
    text(errors, `${label}.label`, item.label, LIMITS.counterLabel);
    if (item.suffix !== undefined && !(typeof item.suffix === "string" && item.suffix.length <= LIMITS.suffix)) {
      errors.push(`${label}.suffix: at most ${LIMITS.suffix} characters`);
    }
    if (item.note !== undefined) text(errors, `${label}.note`, item.note, LIMITS.note);
  });
}

function validateSide(errors, at, side, baseDir) {
  if (!isObject(side)) return errors.push(`${at}: must be an object`);
  for (const key of Object.keys(side)) if (!["label", "image", "points"].includes(key)) errors.push(`${at}.${key}: unknown field`);
  text(errors, `${at}.label`, side.label, LIMITS.sideLabel);
  const hasImage = side.image !== undefined && side.image !== null && side.image !== "";
  const hasPoints = side.points !== undefined;
  if (hasImage === hasPoints) errors.push(`${at}: give either image or points`);
  if (hasImage) file(errors, `${at}.image`, side.image, baseDir, IMAGE, "an image (png, jpg, gif, svg, webp)");
  if (hasPoints) {
    if (!Array.isArray(side.points) || side.points.length < 1 || side.points.length > 3) errors.push(`${at}.points: 1 to 3 lines`);
    else side.points.forEach((p, i) => text(errors, `${at}.points[${i}]`, p, LIMITS.point));
  }
}

function validateScene(errors, at, scene, baseDir) {
  switch (scene.type) {
    case "hook": return validateHook(errors, at, scene);
    case "title": return text(errors, `${at}.promise`, scene.promise, LIMITS.promise);
    case "ui": return validateUi(errors, at, scene, baseDir);
    case "terminal": return validateTerminal(errors, at, scene);
    case "counter": return validateCounter(errors, at, scene);
    case "compare":
      validateSide(errors, `${at}.before`, scene.before, baseDir);
      return validateSide(errors, `${at}.after`, scene.after, baseDir);
    case "list": return checkItemList(errors, `${at}.items`, scene.items, 3, LIMITS.listItem);
    default: return undefined;
  }
}

function validateScenes(errors, scenes, baseDir) {
  if (!Array.isArray(scenes)) return errors.push("scenes: must be a list of scenes");
  if (scenes.length < 5 || scenes.length > 8) errors.push(`scenes: use 5 to 8 scenes (you have ${scenes.length})`);
  const types = scenes.map((s) => (isObject(s) ? s.type : undefined));
  if (types[0] !== "hook") errors.push("scenes: the first scene must be a hook");
  if (types.length && types.at(-1) !== "end") errors.push("scenes: the last scene must be end");
  for (const type of SCENE_TYPES) {
    const n = types.filter((t) => t === type).length;
    if (type === "title" && n > 1) errors.push("scenes: title can appear at most once");
    else if (type !== "title" && n > 2) errors.push(`scenes: ${type} can appear at most twice`);
  }
  scenes.forEach((scene, i) => {
    const at = `scenes[${i}]`;
    if (!isObject(scene)) return errors.push(`${at}: must be an object`);
    if (!SCENE_TYPES.includes(scene.type)) return errors.push(`${at}.type: must be one of ${SCENE_TYPES.join(", ")}`);
    for (const key of Object.keys(scene)) if (key !== "type" && !SCENE_KEYS[scene.type].includes(key)) errors.push(`${at}.${key}: unknown field`);
    validateScene(errors, at, scene, baseDir);
  });
}

function validateV2(story, baseDir) {
  const errors = [];
  for (const key of Object.keys(story)) if (!V2_KNOWN.includes(key)) errors.push(`${key}: unknown field`);
  if (story.version !== 2) errors.push("version: must be 2");
  text(errors, "name", story.name, LIMITS.name);
  checkUrl(errors, story.url);
  text(errors, "install", story.install, LIMITS.install);
  const placeholder = typeof story.install === "string" ? story.install.match(PLACEHOLDER)?.[0] : undefined;
  if (placeholder) errors.push(`install: use a real value, not a placeholder like ${placeholder}`);
  if (story.accent !== undefined && !(typeof story.accent === "string" && HEX.test(story.accent))) {
    errors.push("accent: must be a hex colour like #0f766e");
  }
  if (story.style !== undefined && !STYLES.includes(story.style)) errors.push(`style: must be one of ${STYLES.join(", ")}`);
  file(errors, "logo", story.logo, baseDir, LOGO, "a PNG or SVG");
  if (story.music !== "heygen") file(errors, "music", story.music, baseDir, AUDIO, "an audio (mp3, m4a, wav, ogg)");
  if (story.sfx !== undefined && typeof story.sfx !== "boolean") errors.push("sfx: must be true or false");
  if (story.endCard !== undefined && typeof story.endCard !== "boolean") errors.push("endCard: must be true or false");
  validateScenes(errors, story.scenes, baseDir);
  return errors;
}

export function validateStory(story, baseDir) {
  if (!isObject(story)) return ["story.json must be a JSON object"];
  if (isV1(story)) {
    const v1Errors = validateV1(story, baseDir);
    return v1Errors.length ? v1Errors : validateV2(toV2(story, baseDir), baseDir);
  }
  return validateV2(story, baseDir);
}
