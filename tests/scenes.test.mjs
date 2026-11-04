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

// ---------- ui camera (pure functions in RR.cam) ----------

const wideG = RR.cam.geometry(1920, 1080);
const tallG = RR.cam.geometry(1080, 1920);

test("ui camera geometry: the window is 1460 x 860, scaled 960/1460 in tall, centred across", () => {
  assert.deepEqual([wideG.K, wideG.wx, wideG.wy, wideG.WW, wideG.WH], [1, 230, 110, 1460, 860]);
  assert.equal(tallG.K, 960 / 1460);
  assert.equal(tallG.wx, 60);
  assert.ok(Math.abs(tallG.WW - 960) < 1e-9);
});

test("ui camera: a focus box maps from image pixels (or screen CSS px) into the frame", () => {
  const view = { scale: 0.5, x: 10, y: 20 };
  assert.deepEqual(RR.cam.rect(wideG, view, [100, 200, 400, 300]), { x: 230 + 10 + 50, y: 110 + 54 + 20 + 100, w: 200, h: 150 });
});

test("ui camera: a shot centres the box, keeps the window over the frame, but always keeps the box in the margins", () => {
  const r = { x: 300, y: 300, w: 400, h: 200 };
  const s = RR.cam.shot(wideG, r, 2, 960, 540, 100, 1040);
  assert.equal(s.scale, 2);
  // Centred: X + 2 * 500 = 960 would put the window's left edge at 2 * 230 - 40 = 420 > 0, so the window clamp wins...
  assert.ok(s.x <= -2 * wideG.wx + 1e-9, "the window's left edge stays at or past the frame's left edge");
  // ...but the box's left edge is never pushed past the margin.
  assert.ok(s.x + 2 * r.x >= RR.cam.SAFE - 1e-9);
  // A box that cannot fit between the margins is centred between them.
  const big = RR.cam.shot(wideG, { x: 230, y: 164, w: 1460, h: 806 }, 2, 960, 540, 100, 1040);
  assert.ok(Math.abs(big.x + 2 * (230 + 730) - 960) < 1e-6);
});

test("ui camera: a focus box that cuts a text box is widened to take it whole", () => {
  const texts = [{ x: 90, y: 10, w: 60, h: 20 }, { x: 300, y: 40, w: 100, h: 20 }, { x: 160, y: 80, w: 30, h: 20 }, { x: 600, y: 600, w: 10, h: 10 }];
  // Cuts the first (x 90-150) and the second (x 300-400); holds the third whole; misses the fourth.
  assert.deepEqual(RR.cam.widen({ x: 100, y: 0, w: 250, h: 100 }, texts), { x: 90, y: 0, w: 310, h: 100 });
  // Widening can catch another text box, which is then taken too.
  assert.deepEqual(RR.cam.widen({ x: 0, y: 0, w: 120, h: 30 }, [{ x: 100, y: 0, w: 50, h: 30 }, { x: 140, y: 0, w: 50, h: 30 }]), { x: 0, y: 0, w: 190, h: 30 });
});

test("ui camera: the frame's edges are moved off any text they would cut", () => {
  // Text in frame px at identity; at scale 1 with X = 0 the frame's left edge (x = 0) cuts the first box.
  const texts = [{ x: -30, y: 100, w: 80, h: 30 }, { x: 600, y: 200, w: 100, h: 30 }];
  const box = { x: 300, y: 100, w: 200, h: 100 };
  const out = RR.cam.clean(wideG, { x: 0, y: 0, scale: 1 }, texts, box, 0, 1080);
  const cuts = (o) => texts.filter((t) => { const l = o.x + o.scale * t.x, rr = l + o.scale * t.w; return l < 0 && rr > 0; }).length;
  assert.equal(cuts(out), 0);
  assert.ok(Math.abs(out.x) <= 60, "a small move");
  // The box stays inside the margins.
  assert.ok(out.x + box.x >= RR.cam.SAFE);
});

test("ui camera: tall frames a box by height (about half the frame) and pans across a box wider than the frame", () => {
  const r = RR.cam.rect(tallG, { scale: 1, x: 0, y: 0 }, [240, 190, 980, 500]);
  const plan = RR.cam.focus(tallG, r, [], { top: 250, bottom: 1880 });
  assert.ok(Math.abs(plan.from.scale * r.h - 0.5 * 1920) < 1 || plan.from.scale === 2.6 || plan.from.scale === 1.2, "box about half the height");
  assert.ok(plan.to, "a box wider than the frame is panned");
  assert.ok(Math.abs(plan.from.x + plan.from.scale * r.x - RR.cam.SAFE) < 30, "the pan starts at the box's left edge");
  assert.ok(Math.abs(plan.to.x + plan.to.scale * (r.x + r.w) - (1080 - RR.cam.SAFE)) < 30, "and ends at its right edge");
  // A narrow box is not panned.
  const narrow = RR.cam.rect(tallG, { scale: 1, x: 0, y: 0 }, [900, 190, 300, 300]);
  assert.equal(RR.cam.focus(tallG, narrow, [], { top: 250, bottom: 1880 }).to, null);
  // Wide keeps the brief's rule: the box fills at most 80% of the width, scale 1.2 to 2.6.
  const w = RR.cam.focus(wideG, RR.cam.rect(wideG, { scale: 1, x: 0, y: 0 }, [240, 190, 980, 500]), [], { top: 166, bottom: 1040 });
  assert.ok(w.from.scale * 980 <= 0.8 * 1920 + 1e-6 && w.from.scale >= 1.2 && w.to === null);
});

test("ui camera: the ease-back for the caption is at rest by end - 0.45, whatever the caption's length", () => {
  for (const [captionAt, end] of [[3.1, 3.1 + 1.4 + 0.35], [2.2, 2.2 + 0.5 + 0.35], [4.5, 4.5 + 1.7 + 0.35]]) {
    const b = RR.cam.back(captionAt, end);
    assert.ok(b.t + b.duration <= end - 0.45 + 1e-9, `${captionAt} ${end}`);
    assert.ok(b.duration > 0 && b.duration <= 0.7);
    assert.equal(b.t, captionAt - 0.15);
  }
});

test("ui zoom exit: chips and caption leave first, and a coloured tick becomes the flood disc", () => {
  const ui = scene("ui.html");
  assert.match(ui, /if \(D\.out === "zoom"\) tl\.to\(chips\.concat\(cap \? \[cap\] : \[\]\), \{ opacity: 0, filter: "blur\(8px\)", duration: 0\.15, ease: "power2\.in" \}, end - 0\.45\)/);
  assert.match(ui, /zt\.setAttribute\("data-zoom-disc", disc\)/);
  const runtime = readFileSync(join(TEMPLATE, "runtime.js"), "utf8");
  assert.match(runtime, /const disc = target\.getAttribute\("data-zoom-disc"\)/);
  // The disc turns into the next ground visibly, over end - 0.15 -> end - 0.045 (its growth: see the zoom dive test).
  assert.match(runtime, /backgroundColor: D\.nextGround \|\| disc, duration: 0\.105[^)]*\}, end - 0\.15\)/);
  // From the disc on, the camera opts out of motion blur (its redraw would land above the disc).
  assert.match(runtime, /tl\.set\(cam, \{ attr: \{ "data-motion-blur": "off" \} \}, end - 0\.3\)/);
  // The screen-chosen colour is made opaque.
  assert.match(ui, /disc = opaque\(bg\)/);
});

test("ui camera, tall: a pan is aimed at the side of the box where the screen acts", () => {
  const r = RR.cam.rect(tallG, { scale: 1, x: 0, y: 0 }, [240, 190, 980, 500]);
  const p = RR.cam.focus(tallG, r, [], { top: 250, bottom: 1880 });
  // A status column at the right of the box is shown by the pan's end; a name column at its left by its start.
  const right = RR.cam.rect(tallG, { scale: 1, x: 0, y: 0 }, [1000, 250, 200, 300]);
  const left = RR.cam.rect(tallG, { scale: 1, x: 0, y: 0 }, [260, 250, 200, 300]);
  assert.equal(RR.cam.aim(tallG, p, right), "to");
  assert.equal(RR.cam.aim(tallG, p, left), "from");
});


test("ui camera: text is measured as it shows, cut by its clipping boxes; a widened box stays on the window body", () => {
  // An ellipsised line far wider than its 300 px box shows only inside the box; text wholly clipped away is gone.
  assert.deepEqual(RR.cam.clip({ x: 100, y: 50, w: 4000, h: 20 }, [{ x: 90, y: 40, w: 300, h: 40 }]), { x: 100, y: 50, w: 290, h: 20 });
  assert.equal(RR.cam.clip({ x: -5000, y: 5000, w: 900, h: 900 }, [{ x: 0, y: 0, w: 1460, h: 806 }]), null);
  assert.deepEqual(RR.cam.clip({ x: 10, y: 10, w: 20, h: 20 }, []), { x: 10, y: 10, w: 20, h: 20 });
  // widen never grows a box past its bound (the body), even when a text box reaches beyond it.
  const body = { x: 230, y: 164, w: 1460, h: 806 };
  assert.deepEqual(RR.cam.widen({ x: 300, y: 300, w: 200, h: 100 }, [{ x: 450, y: 320, w: 5000, h: 20 }], body), { x: 300, y: 300, w: 1390, h: 100 });
});

test("ui: the camera never redraws over the chip or caption (it opts out of motion blur)", () => {
  const ui = scene("ui.html");
  assert.match(ui, /<div class="ui-move" data-layout-allow-overflow data-motion-blur="off">/);
  // Statically: an attribute switched by the timeline is not something to rely on for the capture.
  assert.ok(!/"data-motion-blur": "on"/.test(ui));
});

test("zoom dive: the camera blurs as it dives (motion blur stays off), the dive starts sooner, the disc covers by end - 0.09", () => {
  const runtime = readFileSync(join(TEMPLATE, "runtime.js"), "utf8");
  assert.match(runtime, /tl\.fromTo\(cam, \{ filter: "blur\(0px\)" \}, \{ filter: "blur\(10px\)", duration: 0\.3, ease: "power2\.in", immediateRender: false \}, end - 0\.3\)/);
  assert.match(runtime, /tl\.to\(cam, \{ scale: 3, transformOrigin: cx \+ "px " \+ cy \+ "px", duration: 0\.45, ease: "power2\.in" \}, end - 0\.45\)/);
  // The disc's full size reaches the farthest corner from its centre, at end - 0.09.
  assert.match(runtime, /const far = Math\.max\(Math\.hypot\(cx, cy\), Math\.hypot\(W - cx, cy\), Math\.hypot\(cx, H - cy\), Math\.hypot\(W - cx, H - cy\)\)/);
  assert.match(runtime, /scale: \(far \/ r\) \* 1\.02, duration: 0\.21, ease: "power3\.in", immediateRender: false \}, end - 0\.3\)/);
});

// ---------- terminal and compare (Task 7) ----------

test("terminal push: 1.15 about the focus line, the text block kept inside the 40 px margins, the line lifted towards the middle", () => {
  // Wide: an 1150 px block fits at 1.15.
  const wide = RR.termPush(1920, 1080, { x: 266, y: 260, w: 1150, h: 560 }, { x: 210, y: 480, w: 1500, h: 42 });
  assert.equal(wide.scale, 1.15);
  assert.equal(wide.oy, 501);
  assert.ok(wide.ty > 0 && wide.ty <= 180, "lifted down towards the middle");
  const on = (p, x) => p.ox + p.tx + p.scale * (x - p.ox);
  assert.ok(on(wide, 266) >= 40 - 1e-9 && on(wide, 266 + 1150) <= 1880 + 1e-9);
  // Tall: a 900 px block cannot take 1.15 inside 1000 px; the scale gives way, never the margins.
  const tall = RR.termPush(1080, 1920, { x: 90, y: 700, w: 900, h: 700 }, { x: 50, y: 900, w: 980, h: 36 });
  assert.ok(Math.abs(tall.scale - 1000 / 900) < 1e-9);
  assert.ok(on(tall, 90) >= 40 - 1e-6 && on(tall, 990) <= 1040 + 1e-6);
  // A short block keeps 1.15 and moves part of the way towards the centre, staying in the margins.
  const short = RR.termPush(1080, 1920, { x: 90, y: 700, w: 400, h: 300 }, { x: 50, y: 760, w: 980, h: 36 });
  assert.equal(short.scale, 1.15);
  assert.ok(short.tx > 0 && on(short, 90) >= 40 - 1e-9);
  // The lift is capped.
  assert.equal(RR.termPush(1080, 1920, { x: 90, y: 100, w: 400, h: 50 }, { x: 50, y: 100, w: 980, h: 36 }).ty, 180);
});

test("terminal: output lines are UI text, the camera layer opts out of motion blur, the push is at rest by end - 0.45", () => {
  const term = scene("terminal.html");
  assert.match(term, /<div class="term-move" data-layout-allow-overflow data-motion-blur="off">/);
  // The zoom element opts out of motion blur too: a motion-blurred dive is redrawn above the runtime's zoom dot.
  assert.match(term, /<div class="cam" data-motion-blur="off">/);
  assert.match(term, /<div class="term hero">/);
  assert.match(term, /class="ground term-glow" aria-hidden="true" data-layout-ignore/);
  assert.match(term, /class="ground term-dots" aria-hidden="true" data-layout-ignore/);
  assert.match(term, /const pushAt = Math\.max\(0\.6, Math\.min\(Math\.max\(outDone \+ 0\.05, popped\), end - 0\.45 - 0\.6\)\)/);
  assert.match(term, /duration: Math\.min\(0\.6, end - 0\.45 - pushAt\), ease: "power2\.inOut"/);
  assert.match(term, /RR\.type\(tl, cmd, typeStart, 0\.05\)/);
  assert.match(term, /outputStart \+ 0\.075 \* i/);
  // The dot grid stays at 9% ink.
  assert.match(term, /--dots: rgba\(255, 255, 255, 0\.09\)/);
});

test("compare: the wipe clips the after panel (inset, 0.8 s power2.inOut), the edge rides it crisp, the lean-in is at rest by end - 0.45", () => {
  const cmp = scene("compare.html");
  assert.match(cmp, /clipPath: wide \? "inset\(0% 100% 0% 0%\)" : "inset\(0% 0% 100% 0%\)" \}, \{ clipPath: "inset\(0% 0% 0% 0%\)", duration: WIPE, ease: "power2\.inOut" \}, wipeStart\)/);
  assert.match(cmp, /const WIPE = 0\.8;/);
  assert.match(cmp, /<div class="cmp-edge" aria-hidden="true" data-layout-ignore data-motion-blur="off">/);
  assert.match(cmp, /<div class="cmp-after hero" data-zoom-target data-layout-allow-occlusion>/);
  assert.match(cmp, /<div class="cam" data-motion-blur="off"><div class="cmp-stage">/);
  assert.match(cmp, /class="ground cmp-grid" aria-hidden="true" data-layout-ignore/);
  assert.match(cmp, /duration: Math\.max\(0\.1, end - 0\.45 - hold0\), ease: "power1\.out" \}, hold0\)/);
  assert.match(cmp, /if \(D\.out === "zoom"\) tl\.to\(chipA, \{ opacity: 0, filter: "blur\(8px\)", duration: 0\.15, ease: "power2\.in" \}, end - 0\.45\)/);
  // The after label pops when the wipe passes 60%.
  assert.match(cmp, /if \(ease\(m\) < 0\.6\) lo = m; else hi = m;/);
});
