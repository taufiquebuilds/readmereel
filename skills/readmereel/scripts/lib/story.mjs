import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const LIMITS = { name: 24, promise: 60, problem: 70, featureTitle: 40, featureDetail: 80, install: 48, url: 60 };
export const DEFAULT_ACCENT = "#22c55e";

const KNOWN = ["name", "promise", "problem", "features", "install", "url", "stars", "logo", "accent", "music", "endCard"];
const HEX = /^#[0-9a-fA-F]{6}$/;
const URL_LIKE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;
const IMAGE = /\.(png|jpe?g|gif|svg|webp)$/i;
const LOGO = /\.(png|svg)$/i;
const AUDIO = /\.(mp3|m4a|wav|ogg)$/i;

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

export function validateStory(story, baseDir) {
  if (story === null || typeof story !== "object" || Array.isArray(story)) return ["story.json must be a JSON object"];
  const errors = [];
  for (const key of Object.keys(story)) if (!KNOWN.includes(key)) errors.push(`${key}: unknown field`);
  text(errors, "name", story.name, LIMITS.name);
  text(errors, "promise", story.promise, LIMITS.promise);
  text(errors, "problem", story.problem, LIMITS.problem);
  if (!Array.isArray(story.features) || story.features.length !== 3) {
    errors.push("features: must be a list of exactly 3");
  } else {
    story.features.forEach((f, i) => {
      const label = `features[${i + 1}]`;
      if (f === null || typeof f !== "object") return errors.push(`${label}: must be an object`);
      text(errors, `${label}.title`, f.title, LIMITS.featureTitle);
      text(errors, `${label}.detail`, f.detail, LIMITS.featureDetail);
      file(errors, `${label}.image`, f.image, baseDir, IMAGE, "an image (png, jpg, gif, svg, webp)");
    });
  }
  text(errors, "install", story.install, LIMITS.install);
  if (typeof story.url !== "string" || !URL_LIKE.test(story.url)) errors.push("url: must be a web address like github.com/you/repo");
  else if (story.url.length > LIMITS.url) errors.push(`url: ${story.url.length} characters, the limit is ${LIMITS.url}`);
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
