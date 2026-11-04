import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TEMPLATE = join(import.meta.dirname, "..", "skills", "readmereel", "template");
// The runtime is a browser script defining `var RR`; its helpers that touch no DOM can run here as they are.
const RR = new Function(`${readFileSync(join(TEMPLATE, "runtime.js"), "utf8")}\nreturn RR;`)();

test("counter values land with at most one decimal place, cut from the value and never rounded up", () => {
  assert.equal(RR.numText(4812), "4,812");
  assert.equal(RR.numText(4.5), "4.5");
  assert.equal(RR.numText(12.5), "12.5");
  assert.equal(RR.numText(999999.9), "999,999.9");
  assert.equal(RR.numText(-9999999), "-9,999,999");
  assert.equal(RR.numText(-0.5), "-0.5");
  assert.equal(RR.numText(99.95), "99.9");
  assert.equal(RR.decimals(4812), 0);
  assert.equal(RR.decimals(4.5), 1);
  assert.equal(RR.decimals(99.95), 1);
});

test("a roll lands on the value's exact text", () => {
  const el = { textContent: "" };
  let tween;
  const tl = { to: (o, v) => { tween = { o, v }; } };
  RR.roll(tl, el, 0, 99.95, 0, 1);
  assert.equal(el.textContent, "0.0");
  tween.o.v = 99.95;
  tween.v.onUpdate();
  assert.equal(el.textContent, "99.9");
});

test("the title keeps the gap in a two-word name (its letter spans use a non-breaking space)", () => {
  const html = readFileSync(join(TEMPLATE, "scenes", "title.html"), "utf8");
  // A span holding only a normal space is whitespace-only and collapses to nothing as an inline-block.
  assert.match(html, /c === " " \? "\\u00a0" : c/);
});
