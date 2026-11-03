import { copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ACCENT } from "./story.mjs";

export const TEMPLATE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../template");
export const DURATION = 25;
export const LAYOUTS = {
  wide: { width: 1920, height: 1080, video: "video-16x9.mp4" },
  tall: { width: 1080, height: 1920, video: "video-9x16.mp4" },
};

function typeOf(id, value) {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  return id === "accent" ? "color" : "string";
}

export function variablesFor(story, assets) {
  const values = { name: story.name, promise: story.promise, problem: story.problem };
  story.features.forEach((f, i) => {
    values[`f${i + 1}Title`] = f.title;
    values[`f${i + 1}Detail`] = f.detail;
    values[`f${i + 1}Image`] = assets[`f${i + 1}Image`] ?? "";
  });
  Object.assign(values, {
    install: story.install,
    url: story.url,
    stars: story.stars ?? 0,
    logo: assets.logo ?? "",
    accent: story.accent ?? DEFAULT_ACCENT,
    endCard: story.endCard ?? true,
  });
  return Object.entries(values).map(([id, value]) => ({ id, type: typeOf(id, value), label: id, default: value }));
}

export function musicTag(rel) {
  if (!rel) return "";
  const fade = { version: 1, lanes: [{ target: "volume", points: [{ t: 0, v: 0 }, { t: 1, v: 0.6 }, { t: DURATION - 2, v: 0.6 }, { t: DURATION, v: 0 }] }] };
  return `<audio id="music" src="${rel}" data-start="0" data-duration="${DURATION}" data-track-index="2" data-volume="0.6" data-automation='${JSON.stringify(fade)}'></audio>`;
}

function copyAsset(src, baseDir, projectDir, stem) {
  if (!src) return "";
  const rel = `assets/${stem}${extname(src).toLowerCase()}`;
  copyFileSync(resolve(baseDir, src), join(projectDir, rel));
  return rel;
}

function attr(json) {
  return json.replaceAll("&", "&amp;").replaceAll("'", "&#39;");
}

export function buildProject(story, layout, { baseDir, outDir, templateDir = TEMPLATE_DIR }) {
  const size = LAYOUTS[layout];
  if (!size) throw new Error(`unknown layout: ${layout}`);
  const projectDir = join(outDir, layout);
  rmSync(projectDir, { recursive: true, force: true });
  cpSync(templateDir, projectDir, { recursive: true });
  const assets = { logo: copyAsset(story.logo, baseDir, projectDir, "logo") };
  story.features.forEach((f, i) => {
    assets[`f${i + 1}Image`] = copyAsset(f.image, baseDir, projectDir, `f${i + 1}`);
  });
  const music = copyAsset(story.music, baseDir, projectDir, "music");
  const html = readFileSync(join(projectDir, "index.html"), "utf8")
    .replaceAll("__WIDTH__", String(size.width))
    .replaceAll("__HEIGHT__", String(size.height))
    .replaceAll("__LAYOUT__", layout)
    .replace("__MUSIC__", () => musicTag(music))
    .replace("__VARIABLES__", () => attr(JSON.stringify(variablesFor(story, assets))));
  writeFileSync(join(projectDir, "index.html"), html);
  return projectDir;
}
