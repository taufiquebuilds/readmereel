import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { LIMITS, SCENE_TYPES, STYLES } from "../skills/readmereel/scripts/lib/story.mjs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("plugin manifest points at the skill", () => {
  const plugin = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.equal(plugin.name, "readmereel");
  assert.deepEqual(plugin.skills, ["./skills/readmereel"]);
  assert.ok(existsSync(new URL("../skills/readmereel/SKILL.md", import.meta.url)));
  const market = JSON.parse(read(".claude-plugin/marketplace.json"));
  assert.equal(market.plugins[0].name, "readmereel");
  assert.equal(market.plugins[0].source, "./");
});

// The v2 limits, by key. LIMITS also keeps the v1 keys (featureTitle, featureDetail) for the v1 converter; SKILL.md no
// longer documents those.
const V2_KEYS = [
  "name", "url", "install", "hookLine", "hookWords", "promise", "label", "caption", "command", "outputLine",
  "counterLabel", "suffix", "note", "sideLabel", "point", "listItem",
];

test("SKILL.md has front matter and states the real limits", () => {
  const skill = read("skills/readmereel/SKILL.md");
  assert.match(skill, /^---\nname: readmereel\ndescription: .+\n/);
  for (const key of V2_KEYS) {
    assert.ok(Number.isInteger(LIMITS[key]), `LIMITS.${key} exists`);
    assert.match(skill, new RegExp(`(^|[^\\d])${LIMITS[key]}( |\\b)`), `limit for ${key} (${LIMITS[key]}) is in SKILL.md`);
  }
  assert.ok(skill.includes("scripts/render.mjs"));
});

test("SKILL.md documents v2 only: every scene type and style, and the carry-over rules", () => {
  const skill = read("skills/readmereel/SKILL.md");
  for (const type of SCENE_TYPES) assert.ok(skill.includes(`\`${type}\``), `scene type ${type} is in SKILL.md`);
  for (const style of STYLES) assert.ok(skill.includes(`\`${style}\``), `style ${style} is in SKILL.md`);
  for (const phrase of ["contact.png", "poster.png", "15 minutes", "Error findings inside a rebuilt screen", "Music skipped:"]) {
    assert.ok(skill.includes(phrase), `${phrase} is in SKILL.md`);
  }
  assert.ok(!skill.includes("featureDetail") && !skill.includes("featureTitle"), "no v1 limit keys");
});

test("every relative link in README.md resolves, except the example media", () => {
  const readme = read("README.md");
  const missing = [...readme.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((href) => !/^(https?:|#|mailto:)/.test(href))
    .filter((href) => !/^examples\/[^/]+\/(video\.gif|poster\.png)$/.test(href))
    .filter((href) => !existsSync(new URL(`../${href}`, import.meta.url)));
  assert.deepEqual(missing, []);
});
