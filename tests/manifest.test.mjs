import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { V1_LIMITS as LIMITS } from "../skills/readmereel/scripts/lib/story.mjs";

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

test("SKILL.md has front matter and states the real limits", () => {
  const skill = read("skills/readmereel/SKILL.md");
  assert.match(skill, /^---\nname: readmereel\ndescription: .+\n/);
  for (const [key, max] of Object.entries(LIMITS)) assert.ok(skill.includes(`${max}`), `limit for ${key} (${max}) is in SKILL.md`);
  assert.ok(skill.includes("scripts/render.mjs"));
});
