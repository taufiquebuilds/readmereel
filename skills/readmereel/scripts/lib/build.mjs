import { spawnSync } from "node:child_process";
import { closeSync, constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { musicTag } from "./music-tag.mjs";
import { planFilm } from "./plan.mjs";
import { cssUnescape, decodeEntities, MAX_IMAGES, sanitizeScreen, scopeCss } from "./sanitize.mjs";
import { imageSize, toV2 } from "./story.mjs";

// Film plan -> HyperFrames project: a root index.html that mounts one sub-composition per scene (overlapping by the
// transition length) plus the sound cues, and one file per scene stamped from template/scenes/<type>.html.

export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../template");
export const LAYOUTS = {
  wide: { width: 1920, height: 1080, video: "video-16x9.mp4" },
  tall: { width: 1080, height: 1920, video: "video-9x16.mp4" },
};

// Per effect: gain, and an optional fade over the clip's last seconds.
const SFX = {
  whoosh: { volume: 0.6 },
  pop: { volume: 0.5 },
  "click-soft": { volume: 0.7 },
  "key-press": { volume: 0.5 },
  "impact-bass-1": { volume: 0.75, fadeOut: 0.4 },
};
const SFX_DEFAULT = { volume: 0.55 };
const SFX_MAX = 2;

// Plan times are already whole frames at 4 decimals; this only keeps float noise out of the HTML.
const num = (x) => Number(Number(x).toFixed(4));

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// JSON for a <script type="application/json">: "</" can never close the script and "<!--" can never start the
// script-data escape state, and JSON.parse still reads it back unchanged.
function scriptJson(value) {
  return JSON.stringify(value).replaceAll("<!--", "\\u003c!--").replaceAll("</", "<\\/");
}

// One pass over the template: values are never scanned again, so story text such as "$&" or "__DATA__" is inserted
// as typed. A placeholder without a value is a template bug and fails the build.
function fill(template, slots, where) {
  return template.replace(/__([A-Z][A-Z0-9_]*?)__/g, (whole, key) => {
    if (!Object.hasOwn(slots, key)) throw new Error(`${where}: no value for ${whole}`);
    return String(slots[key]);
  });
}

function copyInto(projectDir, src, rel) {
  mkdirSync(dirname(join(projectDir, rel)), { recursive: true });
  copyFileSync(src, join(projectDir, rel));
  return rel;
}

// A story file the build reads or copies: a plain file (not a symlink, and with no other hard link, which could be a
// file from anywhere on the disk) whose real path is inside baseDir. Errors name the story field. Returns the real path.
function storyFile(baseDir, file, field, what, shown) {
  let stat;
  try { stat = lstatSync(file); } catch { throw new Error(`${field}: ${what} not found: ${shown}`); }
  if (stat.isSymbolicLink()) throw new Error(`${field}: ${what} is a symbolic link: ${shown}`);
  if (!stat.isFile()) throw new Error(`${field}: ${what} is not a file: ${shown}`);
  if (stat.nlink > 1) throw new Error(`${field}: ${what} has other hard links (refused, it may be a file from outside the project): ${shown}`);
  const real = realpathSync(file);
  const rel = relative(realpathSync(baseDir), real);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${field}: ${what} is outside the project folder: ${shown}`);
  }
  return real;
}

// What an image file must start with, by extension. SVG is text: it must contain an <svg> element.
const IMAGE_KINDS = {
  ".png": ["a PNG", (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ".jpg": ["a JPEG", (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ".gif": ["a GIF", (b) => b.subarray(0, 4).toString("latin1") === "GIF8"],
  ".webp": ["a WebP", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  ".svg": ["an SVG", (b) => /<svg[\s>/]/i.test(b.toString("utf8"))],
};
IMAGE_KINDS[".jpeg"] = IMAGE_KINDS[".jpg"];
const SVG_SNIFF = 64 * 1024;

const IMAGE_MAX_BYTES = 25 * 1024 * 1024;

// Reads a story file that storyFile has checked by path, from one descriptor opened once: non-blocking (a FIFO swapped
// in after the check cannot hang the build) and without following a symlink, then checked again on the descriptor
// itself (a plain file, no other hard link, at most maxBytes) and read from it. What is returned is what was checked.
function readStoryFile(real, field, what, shown, maxBytes, limit) {
  let fd;
  try { fd = openSync(real, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW); } catch {
    throw new Error(`${field}: ${what} could not be opened: ${shown}`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error(`${field}: ${what} is not a file: ${shown}`);
    if (stat.nlink !== 1) throw new Error(`${field}: ${what} has other hard links (refused, it may be a file from outside the project): ${shown}`);
    if (stat.size > maxBytes) throw new Error(`${field}: ${what} is over ${limit}: ${shown}`);
    // One byte more than fstat says, to notice a file that changes while it is read.
    const buf = Buffer.alloc(stat.size + 1);
    let n = 0;
    for (let r; n < buf.length && (r = readSync(fd, buf, n, buf.length - n, n)) > 0;) n += r;
    if (n !== stat.size) throw new Error(`${field}: ${what} changed while it was read: ${shown}`);
    return buf.subarray(0, n);
  } finally { closeSync(fd); }
}

// True when an image would move on its own (APNG, a GIF with more than one frame, an animated WebP, an SVG with SMIL
// or CSS animation): a film frame must not depend on when the browser happens to draw it. Truncated or odd data reads
// as still; the kind check before this has already made sure the bytes are the format the name says.
export function isAnimated(data, ext) {
  if (ext === ".png") {
    // An acTL chunk before the first IDAT makes a PNG an APNG.
    for (let i = 8; i + 8 <= data.length;) {
      const len = data.readUInt32BE(i), type = data.toString("latin1", i + 4, i + 8);
      if (type === "acTL") return true;
      if (type === "IDAT" || type === "IEND") return false;
      i += 12 + len;
    }
    return false;
  }
  if (ext === ".gif") {
    if (data.length < 13) return false;
    let i = 13 + (data[10] & 0x80 ? 3 * 2 ** ((data[10] & 7) + 1) : 0);
    let frames = 0;
    const skipBlocks = () => { while (i < data.length && data[i] !== 0) i += data[i] + 1; i++; };
    while (i < data.length) {
      const b = data[i];
      if (b === 0x3b) break;
      if (b === 0x21) { i += 2; skipBlocks(); continue; }
      if (b !== 0x2c) break;
      if (++frames > 1) return true;
      const packed = data[i + 9];
      i += 10 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0) + 1;
      skipBlocks();
    }
    return false;
  }
  if (ext === ".webp") {
    if (data.toString("latin1", 12, 16) === "VP8X" && data.length > 20 && data[20] & 0x02) return true;
    for (let i = 12; i + 8 <= data.length;) {
      const type = data.toString("latin1", i, i + 4), len = data.readUInt32LE(i + 4);
      if (type === "ANIM" || type === "ANMF") return true;
      i += 8 + len + (len & 1);
    }
    return false;
  }
  if (ext === ".svg") {
    // Judged decoded, as the browser reads it: entities, CSS escapes (\61nimation, @\6b eyframes) and comments.
    const text = cssUnescape(decodeEntities(data.toString("utf8"))).replace(/\/\*[\s\S]*?\*\//g, "");
    return /<\s*(?:[a-z]+:)?(?:animate|animateTransform|animateMotion|animateColor|set)\b/i.test(text) || /@(?:-[a-z]+-)?keyframes|animation(?:-name)?\s*:/i.test(text);
  }
  return false;
}
const ANIMATED = (field, shown) => new Error(`${field}: image is animated (a film frame must not depend on when it is drawn): ${shown}`);

// Copies an image named in the story into the project: refused when it is a symlink, resolves outside baseDir, has
// other hard links, is over 25 MB or is not the kind of image its extension says. The bytes checked are the bytes written.
function copyImage(projectDir, baseDir, src, rel, field, shown) {
  const real = storyFile(baseDir, src, field, "image", shown);
  const kind = IMAGE_KINDS[extname(src).toLowerCase()];
  if (!kind) throw new Error(`${field}: image is not a PNG, JPEG, GIF, WebP or SVG file: ${shown}`);
  const data = readStoryFile(real, field, "image", shown, IMAGE_MAX_BYTES, "25 MB");
  const head = data.subarray(0, extname(src).toLowerCase() === ".svg" ? SVG_SNIFF : 16);
  if (!kind[1](head)) throw new Error(`${field}: image is not ${kind[0]} file: ${shown}`);
  if (isAnimated(data, extname(src).toLowerCase())) throw ANIMATED(field, shown);
  mkdirSync(dirname(join(projectDir, rel)), { recursive: true });
  writeFileSync(join(projectDir, rel), data);
  return rel;
}

// The sanitizer refuses more than this too; the screen file is checked against it before it is read.
const SCREEN_MAX_BYTES = 256 * 1024;

// The screen file's text, read once from a checked descriptor (see readStoryFile).
const readScreen = (real, field, shown) => readStoryFile(real, field, "the screen file", shown, SCREEN_MAX_BYTES, "256 KB").toString("utf8");

// A rebuilt HTML screen for a `ui` scene: sanitized, its CSS scoped to .screen-<id>, its images copied into
// assets/screens/ and every reference rewritten to the copy. `markup` is the screen in two wrappers: the inner
// .screen-<id> is what the screen's own root rules (html, body, :root) map to, so it may be styled, moved or scaled by
// the screen; the outer .screen-frame-<id>, which no screen selector can reach, clips and contains its paint and can be
// neither transformed, zoomed nor raised (inline !important, so no rule in the screen's CSS can undo it). `style` is the
// screen's CSS in an <style> element of its own, never merged into the scene's stylesheet.
export function prepareScreen(scene, id, { baseDir, projectDir, field = "html" }) {
  const file = resolve(baseDir, scene.html);
  const real = storyFile(baseDir, file, field, "the screen file", scene.html);
  // The sanitizer writes each local image as its copy's name, in one pass; the copies are made (and checked) after.
  const copies = [];
  const mapImage = (path, k) => {
    if (k >= MAX_IMAGES) throw new Error(`${field}: the screen uses more than ${MAX_IMAGES} images`);
    const rel = `assets/screens/${id}-${k + 1}${extname(path).toLowerCase()}`;
    copies.push([path, rel]);
    return rel;
  };
  const { html, css } = sanitizeScreen(readScreen(real, field, scene.html), `screen-${id}`, { mapImage });
  // Inline data images (the sanitizer keeps base64 PNG, GIF, WebP and SVG ones) are checked like files, read as the
  // browser reads them: entities and CSS escapes decoded, and whitespace inside the data dropped.
  const INLINE = { png: ".png", gif: ".gif", webp: ".webp", "svg+xml": ".svg" };
  const text = `${decodeEntities(html)} ${cssUnescape(css)}`;
  for (const m of text.matchAll(/data:image\/(png|gif|webp|svg\+xml)(;base64)?,([^"')<>]+)/gi)) {
    let bytes;
    const payload = m[3].replace(/\s+/g, "");
    try { bytes = m[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8"); } catch { bytes = Buffer.from(payload, "utf8"); }
    if (isAnimated(bytes, INLINE[m[1].toLowerCase()])) throw ANIMATED(field, "an inline data image");
  }
  for (const [path, rel] of copies) copyImage(projectDir, baseDir, resolve(dirname(file), path), rel, field, path);
  const frame = "position:relative!important;overflow:clip!important;contain:paint!important;transform:none!important;zoom:1!important;z-index:auto!important";
  const markup = `<div class="screen-frame-${id}" style="${frame}"><div class="screen-${id}">${html}</div></div>`;
  const style = css ? `<style>${css}</style>` : "";
  return { html, css, markup, style };
}

const badge = (ctx) => (ctx.logo ? `<img src="${escapeHtml(ctx.logo)}" alt="">` : `<i class="glyph"></i>`);
// A counter value as it lands, by the runtime's rule (RR.numText): thousands separators and at most one decimal place,
// cut from String(value) and never rounded, so 99.95 reads "99.9" and never "100.0".
export function counterText(value) {
  const str = String(value);
  const [int, frac = ""] = str.replace("-", "").split(".");
  const d = Math.min(1, frac.length);
  return (str.startsWith("-") ? "-" : "") + Number(int).toLocaleString("en-US") + (d ? "." + frac.slice(0, d) : "");
}

// ---------- ui ----------

// The window body every ui screen is drawn in, in CSS px, in both layouts (tall scales the whole window).
export const UI_BODY = { width: 1460, height: 806 };
// Extra scene data a slot function hands back (merged into the scene's data; a symbol, so fill() never sees it).
const EXTRA_DATA = Symbol("data");

// The repo URL's host, for the window's address pill.
const urlHost = (url) => String(url ?? "").replace(/^https?:\/\//i, "").split("/")[0];

// A state's selector, scoped the way the screen's own CSS is (ids prefixed, inside .screen-<id>), so it can only ever
// match inside the screen. One selector (a list is fine), no rules, at-rules or escapes.
function stateMatch(selector, id, field) {
  const why = `${field}: must be one CSS selector inside the screen, like .status or #row2`;
  if (typeof selector !== "string" || !selector.trim() || /[{};@\\]/.test(selector)) throw new Error(why);
  let scoped;
  try { scoped = scopeCss(`${selector}{}`, `screen-${id}`); } catch { throw new Error(why); }
  const m = /^([^{}]+)\{\}$/.exec(scoped);
  if (!m) throw new Error(why);
  return m[1];
}

function uiSlots(s, ctx) {
  const f = `scenes[${s.index}]`;
  const chips = (s.data.focus ?? [])
    .map((fo, k) => (fo.label ? `<div class="ui-chip" data-focus="${k}"><i class="dot"></i><span data-field="${f}.focus[${k}].label">${escapeHtml(fo.label)}</span></div>` : ""))
    .filter(Boolean)
    .join("\n    ");
  const caption = s.data.caption
    ? `<div class="ui-capwrap"><div class="ui-fade" data-layout-allow-occlusion></div><div class="ui-caption" data-field="${f}.caption">${escapeHtml(s.data.caption)}</div></div>`
    : "";
  const slots = { HOST: escapeHtml(urlHost(ctx.url)), CHIPS: chips, CAPTION: caption, SHOT: "", SCREEN: "", SCREEN_STYLE: "" };
  if (s.data.html) {
    const screen = prepareScreen(s.data, s.id, { baseDir: ctx.baseDir, projectDir: ctx.projectDir, field: `${f}.html` });
    const states = (s.data.states ?? []).map((st, k) => ({ ...st, match: stateMatch(st.selector, s.id, `${f}.states[${k}].selector`) }));
    return { ...slots, SCREEN: screen.markup, SCREEN_STYLE: screen.style, [EXTRA_DATA]: { view: { ...UI_BODY, scale: 1, x: 0, y: 0 }, ...(s.data.states ? { states } : {}) } };
  }
  // Image mode: the copy is the checked bytes, and its size (read from that copy) maps focus boxes, given in the
  // image's own pixels, to the body: contained (object-fit: contain) and centred.
  const rel = copyImage(ctx.projectDir, ctx.baseDir, resolve(ctx.baseDir, s.data.image), `assets/screens/${s.id}${extname(s.data.image).toLowerCase()}`, `${f}.image`, s.data.image);
  const [width, height] = imageSize(join(ctx.projectDir, rel), ctx.projectDir);
  const scale = Math.min(UI_BODY.width / width, UI_BODY.height / height);
  const view = { width, height, scale: num(scale), x: num((UI_BODY.width - width * scale) / 2), y: num((UI_BODY.height - height * scale) / 2) };
  return { ...slots, SHOT: `<img class="ui-shot" src="${escapeHtml(rel)}" alt="">`, [EXTRA_DATA]: { view } };
}

// ---------- terminal and compare ----------

// The terminal's output: one pre-formatted line per output line (UI text for the gate); highlighted lines carry the
// accent background and bar the template pops in.
function terminalSlots(s, ctx) {
  const f = `scenes[${s.index}]`;
  const hl = new Set(s.data.highlight ?? []);
  const lines = (s.data.output ?? []).map((line, k) => (hl.has(k)
    ? `<div class="term-line hl" data-field="${f}.output[${k}]" data-ui-text><i class="term-bg"></i><i class="term-bar"></i><span class="term-text">${escapeHtml(line)}</span></div>`
    : `<div class="term-line" data-field="${f}.output[${k}]" data-ui-text><span class="term-text">${escapeHtml(line)}</span></div>`));
  return { NAME: escapeHtml(ctx.name), COMMAND: escapeHtml(s.data.command), LINES: lines.join("\n        ") };
}

// One side of a compare: its content (an image copied through the safe path, or points) and its label chip. Returns
// the markup and, for an image, its size (read from the copy).
function compareSide(s, side, ctx) {
  const f = `scenes[${s.index}].${side}`;
  const d = s.data[side] ?? {};
  const chip = `<div class="cmp-chip" data-field="${f}.label">${escapeHtml(d.label)}</div>`;
  if (d.image) {
    const rel = copyImage(ctx.projectDir, ctx.baseDir, resolve(ctx.baseDir, d.image), `assets/compare/${s.id}-${side}${extname(d.image).toLowerCase()}`, `${f}.image`, d.image);
    const [width, height] = imageSize(join(ctx.projectDir, rel), ctx.projectDir);
    return { markup: `<div class="cmp-content cmp-shot"><img class="cmp-img" src="${escapeHtml(rel)}" alt=""></div>\n      ${chip}`, size: { width, height } };
  }
  const points = (d.points ?? []).map((p, k) => `<div class="cmp-point"><i class="cmp-mark"></i><span data-field="${f}.points[${k}]">${escapeHtml(p)}</span></div>`);
  return { markup: `<div class="cmp-content cmp-points">${points.join("")}</div>\n      ${chip}`, size: null };
}

function compareSlots(s, ctx) {
  const before = compareSide(s, "before", ctx);
  const after = compareSide(s, "after", ctx);
  return { BEFORE: before.markup, AFTER: after.markup, [EXTRA_DATA]: { sides: { before: before.size, after: after.size } } };
}

// Scene-specific slots. Tasks adding scene types add their entry here.
const SLOTS = {
  hook: (s) => ({
    LINES: (s.data.lines ?? [])
      .map((line, k) => `<div class="hook-line" data-field="scenes[${s.index}].lines[${k}]">${escapeHtml(line)}</div>`)
      .join("\n  "),
  }),
  title: (s, ctx) => ({
    NAME: escapeHtml(s.data.name),
    PROMISE: escapeHtml(s.data.promise),
    LOGO: badge(ctx),
  }),
  list: (s) => {
    const items = s.data.items ?? [];
    return {
      ITEMS: items
        .map((item, k) => `<div class="list-slot"><div class="list-item${k === items.length - 1 ? " hero" : ""}" data-field="scenes[${s.index}].items[${k}]">${escapeHtml(item)}</div></div>`)
        .join("\n    "),
      COUNT: String(items.length).padStart(2, "0"),
    };
  },
  counter: (s) => ({
    ITEMS: (s.data.items ?? [])
      .map((it, k) => {
        const f = `scenes[${s.index}].items[${k}]`;
        const suffix = it.suffix ? `<span class="counter-suffix" data-field="${f}.suffix">${escapeHtml(it.suffix)}</span>` : "";
        const note = it.note ? `\n      <div class="counter-note" data-field="${f}.note">${escapeHtml(it.note)}</div>` : "";
        return `<div class="counter-item${k === 0 ? " hero" : ""}">
      <div class="counter-label" data-field="${f}.label">${escapeHtml(it.label)}</div>
      <div class="counter-figure"${k === 0 ? " data-zoom-target" : ""}><span class="counter-value" data-field="${f}.value">${counterText(it.value)}</span>${suffix}</div>${note}
    </div>`;
      })
      .join("\n    "),
  }),
  end: (s, ctx) => ({
    NAME: escapeHtml(s.data.name),
    INSTALL: escapeHtml(s.data.install),
    URL: escapeHtml(s.data.url),
    LOGO: badge(ctx),
  }),
  ui: uiSlots,
  terminal: terminalSlots,
  compare: compareSlots,
};

// Seconds of audio in a file, or null when ffprobe cannot read it.
function audioLength(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const seconds = Number(String(out.stdout ?? "").trim());
  return out.status === 0 && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function audioTags(cues, sfxDir, projectDir) {
  if (!sfxDir) return "";
  const lengths = {};
  const tags = [];
  for (const cue of cues) {
    const src = join(sfxDir, `${cue.sound}.mp3`);
    if (!existsSync(src)) continue;
    if (!(cue.sound in lengths)) {
      copyInto(projectDir, src, `assets/sfx/${cue.sound}.mp3`);
      lengths[cue.sound] = num(Math.min(audioLength(src) ?? SFX_MAX, SFX_MAX));
    }
    const d = lengths[cue.sound];
    const { volume, fadeOut } = SFX[cue.sound] ?? SFX_DEFAULT;
    const k = tags.length;
    let tag = `<audio id="sfx-${k}" src="assets/sfx/${cue.sound}.mp3" data-start="${num(cue.t)}" data-duration="${d}" data-track-index="${20 + k}" data-volume="${volume}"`;
    if (fadeOut) {
      const lane = { target: "volume", points: [{ t: 0, v: 1 }, { t: num(Math.max(0, d - fadeOut)), v: 1 }, { t: d, v: 0 }] };
      tag += ` data-automation='${JSON.stringify({ version: 1, lanes: [lane] })}'`;
    }
    tags.push(`${tag}></audio>`);
  }
  const credits = join(sfxDir, "CREDITS.md");
  if (tags.length && existsSync(credits)) copyInto(projectDir, credits, "assets/sfx/CREDITS.md");
  return tags.map((t) => `      ${t}`).join("\n");
}

// A music file (absolute path) becomes assets/music.<ext> and one track-99 <audio> tag.
function musicHtml(music, duration, projectDir) {
  if (!music || !existsSync(music)) return "";
  const rel = `assets/music${extname(music).toLowerCase()}`;
  copyInto(projectDir, music, rel);
  return `      ${musicTag(rel, duration)}`;
}

export function buildProject(story, layout, { baseDir, outDir, plan, sfxDir, music, templateDir = TEMPLATE_DIR }) {
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`unknown layout: ${layout}`);
  plan ??= planFilm(toV2(story, baseDir));
  const { width: W, height: H } = size;
  const projectDir = join(outDir, layout);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  mkdirSync(join(projectDir, "assets"), { recursive: true });
  copyFileSync(join(templateDir, "hyperframes.json"), join(projectDir, "hyperframes.json"));
  const logo = story.logo ? copyImage(projectDir, baseDir, resolve(baseDir, story.logo), `assets/logo${extname(story.logo).toLowerCase()}`, "logo", story.logo) : "";
  const runtime = readFileSync(join(templateDir, "runtime.js"), "utf8");
  const ctx = { baseDir, projectDir, logo, url: story.url, name: story.name };

  for (const s of plan.scenes) {
    const file = join(templateDir, "scenes", `${s.type}.html`);
    if (!existsSync(file)) throw new Error(`no template for scene type "${s.type}" (scenes[${s.index}])`);
    const own = SLOTS[s.type]?.(s, ctx) ?? {};
    const slots = {
      ID: s.id,
      INDEX: s.index,
      W,
      H,
      LAYOUT: layout,
      STYLE: s.data.style ?? "midnight",
      RUNTIME: runtime,
      ...own,
      DATA: scriptJson(own[EXTRA_DATA] ? { ...s, data: { ...s.data, ...own[EXTRA_DATA] } } : s),
    };
    writeFileSync(join(projectDir, "compositions", `${s.id}-${s.type}.html`), fill(readFileSync(file, "utf8"), slots, `scenes/${s.type}.html`));
  }

  // Later scenes paint over earlier ones, except that a scene leaving by carry stays above the next one (it clears its
  // ground around its hero while the next scene builds underneath).
  const z = [];
  for (let i = plan.scenes.length - 1; i >= 0; i--) z[i] = plan.scenes[i].out === "carry" && i + 1 < plan.scenes.length ? z[i + 1] + 5 : 10 * (i + 1);
  const zIndex = (s, i) => z[i];
  const hosts = plan.scenes
    .map((s, i) => `      <div id="h-${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}-${s.type}.html" data-start="${num(s.start)}" data-duration="${num(s.duration)}" data-track-index="${i}" data-width="${W}" data-height="${H}" data-track-kind="graphics" style="z-index:${zIndex(s, i)}"></div>`)
    .join("\n");
  const root = fill(readFileSync(join(templateDir, "root.html"), "utf8"), {
    W,
    H,
    BG: plan.scenes[0]?.ground ?? "#08090b",
    DURATION: num(plan.duration),
    HOSTS: hosts,
    AUDIO: [audioTags(plan.cues ?? [], sfxDir, projectDir), musicHtml(music, plan.duration, projectDir)].filter(Boolean).join("\n"),
  }, "root.html");
  writeFileSync(join(projectDir, "index.html"), root);
  return projectDir;
}
