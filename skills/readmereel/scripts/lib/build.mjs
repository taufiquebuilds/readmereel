import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { planFilm } from "./plan.mjs";
import { cssString, escAttr, sanitizeScreen } from "./sanitize.mjs";
import { toV2 } from "./story.mjs";

// Film plan -> HyperFrames project: a root index.html that mounts one sub-composition per scene (overlapping by the
// transition length) plus the sound cues, and one file per scene stamped from template/scenes/<type>.html.

export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../template");
// v1's fixed film length. Only hf.mjs still reads it (its check sample count) until the v2 render flow replaces it.
export const DURATION = 25;
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

// A rebuilt HTML screen for a `ui` scene: sanitized, its CSS scoped to .screen-<id>, its images copied into
// assets/screens/ and every reference rewritten to the copy. `markup` is the screen inside its own .screen-<id> wrapper,
// which clips and contains its paint so nothing in the screen can draw outside it (inline !important, so no rule in the
// screen's CSS can undo it); `style` is the screen's CSS in an <style> element of its own, never merged into the
// scene's stylesheet.
export function prepareScreen(scene, id, { baseDir, projectDir, field = "html" }) {
  const file = resolve(baseDir, scene.html);
  const { html: cleanHtml, css: cleanCss, images } = sanitizeScreen(readFileSync(file, "utf8"), `screen-${id}`);
  let html = cleanHtml;
  let css = cleanCss;
  images.forEach((path, k) => {
    const src = resolve(dirname(file), path);
    if (!existsSync(src)) throw new Error(`${field}: image not found: ${path}`);
    const rel = copyInto(projectDir, src, `assets/screens/${id}-${k + 1}${extname(path).toLowerCase()}`);
    html = html.replaceAll(`="${escAttr(path)}"`, `="${rel}"`).replaceAll(escAttr(`url(${cssString(path)})`), escAttr(`url("${rel}")`));
    css = css.replaceAll(`url(${cssString(path)})`, `url("${rel}")`);
  });
  const markup = `<div class="screen-${id}" style="position:relative!important;overflow:clip!important;contain:paint!important">${html}</div>`;
  const style = css ? `<style>${css}</style>` : "";
  return { html, css, markup, style };
}

const badge = (ctx) => (ctx.logo ? `<img src="${escapeHtml(ctx.logo)}" alt="">` : `<i class="glyph"></i>`);
// A counter value as it lands: thousands separators, one decimal place only when the value has one.
export function counterText(value) {
  const decimals = Number.isInteger(value) ? 0 : 1;
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
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
  ui: (s, ctx) => {
    if (!s.data.html) return {};
    const screen = prepareScreen(s.data, s.id, { baseDir: ctx.baseDir, projectDir: ctx.projectDir, field: `scenes[${s.index}].html` });
    return { SCREEN: screen.markup, SCREEN_STYLE: screen.style };
  },
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

export function buildProject(story, layout, { baseDir, outDir, plan, sfxDir, templateDir = TEMPLATE_DIR }) {
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`unknown layout: ${layout}`);
  plan ??= planFilm(toV2(story, baseDir));
  const { width: W, height: H } = size;
  const projectDir = join(outDir, layout);
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(join(projectDir, "compositions"), { recursive: true });
  mkdirSync(join(projectDir, "assets"), { recursive: true });
  copyFileSync(join(templateDir, "hyperframes.json"), join(projectDir, "hyperframes.json"));
  const logo = story.logo ? copyInto(projectDir, resolve(baseDir, story.logo), `assets/logo${extname(story.logo).toLowerCase()}`) : "";
  const runtime = readFileSync(join(templateDir, "runtime.js"), "utf8");
  const ctx = { baseDir, projectDir, logo };

  for (const s of plan.scenes) {
    const file = join(templateDir, "scenes", `${s.type}.html`);
    if (!existsSync(file)) throw new Error(`no template for scene type "${s.type}" (scenes[${s.index}])`);
    const slots = {
      ID: s.id,
      INDEX: s.index,
      W,
      H,
      LAYOUT: layout,
      STYLE: s.data.style ?? "midnight",
      RUNTIME: runtime,
      ...(SLOTS[s.type]?.(s, ctx) ?? {}),
      DATA: scriptJson(s),
    };
    writeFileSync(join(projectDir, "compositions", `${s.id}-${s.type}.html`), fill(readFileSync(file, "utf8"), slots, `scenes/${s.type}.html`));
  }

  const hosts = plan.scenes
    .map((s, i) => `      <div id="h-${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}-${s.type}.html" data-start="${num(s.start)}" data-duration="${num(s.duration)}" data-track-index="${i}" data-width="${W}" data-height="${H}" data-track-kind="graphics" style="z-index:${i + 1}"></div>`)
    .join("\n");
  const root = fill(readFileSync(join(templateDir, "root.html"), "utf8"), {
    W,
    H,
    BG: plan.scenes[0]?.ground ?? "#08090b",
    DURATION: num(plan.duration),
    HOSTS: hosts,
    AUDIO: audioTags(plan.cues ?? [], sfxDir, projectDir),
  }, "root.html");
  writeFileSync(join(projectDir, "index.html"), root);
  return projectDir;
}
