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

test("the title keeps the gap in a two-word name (words are spans with a real space between them)", () => {
  const html = readFileSync(join(TEMPLATE, "scenes", "title.html"), "utf8");
  // A letter span holding only a space would collapse to nothing as an inline-block: spaces stay text between words.
  assert.match(html, /nameText\.split\(\/\( \+\)\/\)/);
  assert.match(html, /name\.appendChild\(document\.createTextNode\(" "\)\)/);
});

test("decorative layers are .ground children the transitions leave alone, and hold no readable text", () => {
  for (const [file, cls] of [["title.html", "title-grid"], ["list.html", "list-ghost"], ["counter.html", "counter-glow"]]) {
    const html = readFileSync(join(TEMPLATE, "scenes", file), "utf8");
    const tag = html.match(new RegExp(`<div class="ground ${cls}"[^>]*>`));
    assert.ok(tag, `${file}: .ground ${cls}`);
    assert.match(tag[0], /aria-hidden="true"/);
    assert.match(tag[0], /data-layout-ignore/);
  }
  // The list's ghost numerals are generated content, not DOM text.
  assert.match(readFileSync(join(TEMPLATE, "scenes", "list.html"), "utf8"), /\.list-ghost-reel::before \{ content: attr\(data-digits\); \}/);
});

test("a counter of 100 or more rolls from its own order of magnitude", () => {
  assert.equal(RR.rollFrom(4812), 1000);
  assert.equal(RR.rollFrom(126), 100);
  assert.equal(RR.rollFrom(-9999999), -1000000);
  assert.equal(RR.rollFrom(999999.9), 100000);
  assert.equal(RR.rollFrom(0.5), 0);
  assert.equal(RR.rollFrom(0), 0);
});

test("small counters roll from 0; from 100 up they roll from their own order of magnitude", () => {
  assert.equal(RR.rollFrom(99), 0);
  assert.equal(RR.rollFrom(18), 0);
  assert.equal(RR.rollFrom(4.5), 0);
  assert.equal(RR.rollFrom(-99.9), 0);
  assert.equal(RR.rollFrom(100), 100);
  assert.equal(RR.rollFrom(-126), -100);
});

const scene = (file) => readFileSync(join(TEMPLATE, "scenes", file), "utf8");

test("push-ins come to rest 0.45 s before the scene ends, easing out", () => {
  assert.match(scene("list.html"), /fromTo\(q\("\.list-slots"\), \{ scale: 1 \}, \{ scale: 1\.03, duration: Math\.max\(0\.1, D\.duration - 0\.45 - 0\.35\), ease: "power1\.out" \}, 0\.35\)/);
  assert.match(scene("counter.html"), /\{ scale: 1\.03, transformOrigin: origin, duration: Math\.max\(0\.1, D\.duration - 0\.45 - starts\[0\]\), ease: "power1\.out" \}, starts\[0\]\)/);
});

test("ground details: title grid at 9% ink, list ghost at 7% on dark and 5% on light, below the count", () => {
  const title = scene("title.html");
  assert.match(title, /#root\[data-tone="dark"\] \{[^}]*--grid: rgba\(255, 255, 255, 0\.09\)/);
  assert.match(title, /#root\[data-tone="light"\] \{[^}]*--grid: rgba\(0, 0, 0, 0\.09\)/);
  const list = scene("list.html");
  assert.match(list, /#root\[data-tone="dark"\] \.list-ghost-reel \{ opacity: 0\.07; \}/);
  assert.match(list, /#root\[data-tone="light"\] \.list-ghost-reel \{ opacity: 0\.05; \}/);
  assert.match(list, /\.list-ghost \{[^}]*top: 56%;/);
});

test("the title fits a long name over at most two lines, keeping words whole", () => {
  const title = scene("title.html");
  assert.match(title, /RR\.fitLines\(name, wide \? 200 : 150, Math\.round\(W \* 0\.8\), 2\)/);
  assert.ok(!/RR\.fit\(name,/.test(title), "no one-line shrink");
});

test("the ui scene: camera, chips, states and caption hooks", () => {
  const ui = scene("ui.html");
  // The screen's own CSS says what a state's class looks like; the template only animates the change.
  assert.match(ui, /screen's CSS defines/i);
  assert.match(ui, /class="cam"/);
  assert.match(ui, /class="ground ui-grid" aria-hidden="true" data-layout-ignore/);
  assert.match(ui, /__SCREEN_STYLE__/);
  assert.match(ui, /\.ui-body \{[^}]*width: 1460px; height: 806px;[^}]*overflow: hidden;[^}]*contain: layout paint size;/);
});
