/* readmereel scene runtime: inlined into every scene file. Deterministic: no timers, clocks or randomness.
   Each scene keeps its own copy on purpose: HyperFrames runs every scene script with a `document` scoped to that
   scene's host, so a runtime shared through `window` would query the first scene's DOM from every scene. */
var RR = (function () {
  const T = 0.35;

  // ---------- colour ----------
  function rgb(hex) {
    const h = String(hex || "#000000").replace("#", "");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  }
  function lum(hex) {
    const c = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function mix(a, b, k) {
    const x = rgb(a), y = rgb(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * k).toString(16).padStart(2, "0")).join("");
  }
  // The colour itself when it reads on the ground (min contrast), else the colour pushed towards black or white until it does.
  function readable(fg, bg, min) {
    min = min || 3;
    if (contrast(fg, bg) >= min) return fg;
    const to = lum(bg) > 0.18 ? "#000000" : "#ffffff";
    for (let k = 0.1; k < 1; k += 0.1) { const c = mix(fg, to, k); if (contrast(c, bg) >= min) return c; }
    return to;
  }
  // Dark ink or light ink, whichever reads better on the colour.
  const onColour = (bg) => (contrast("#111418", bg) > contrast("#ffffff", bg) ? "#111418" : "#ffffff");

  // ---------- scene ----------
  function scene(id) {
    // When mounted, the id is on the host and the authored #root becomes an inner wrapper without it; the root is
    // always the parent of this scene's own data script (the sanitizer never lets a screen carry a <script>).
    const host = document.querySelector('[data-composition-id="' + id + '"]');
    const data = host.querySelector("script.scene-data");
    const R = data.parentElement;
    const D = JSON.parse(data.textContent);
    const tl = gsap.timeline({ paused: true });
    const W = Number(R.dataset.width), H = Number(R.dataset.height);
    const accent = D.data.accent;
    R.style.setProperty("--ground", D.ground);
    R.style.setProperty("--accent", accent);
    R.style.setProperty("--accent-ink", readable(accent, D.ground, 3));
    R.style.setProperty("--on-accent", onColour(accent));
    // Style rules key off attributes, never the root's classes (HyperFrames' lint rejects root-class selectors):
    // #root[data-layout="tall"], #root[data-style="signal"], #root[data-tone="dark"] (light ink on a dark ground).
    R.setAttribute("data-tone", onColour(D.ground) === "#ffffff" ? "dark" : "light");
    const S = { id, R, D, tl, W, H, wide: W > H, q: (s) => R.querySelector(s), qa: (s) => Array.from(R.querySelectorAll(s)) };
    S.done = function () {
      transIn(S);
      transOut(S);
      window.__timelines[id] = tl;
      tl.seek(0);
    };
    return S;
  }

  // ---------- text helpers ----------
  // Split an element's text into word spans (keeps accent words marked).
  function words(el, accentWords) {
    const acc = new Set(accentWords || []);
    const parts = el.textContent.split(/(\s+)/);
    el.textContent = "";
    parts.forEach((p) => {
      if (p === "") return;
      if (/^\s+$/.test(p)) { el.appendChild(document.createTextNode(p)); return; }
      const s = document.createElement("span");
      s.className = "w" + (acc.has(p) ? " acc" : "");
      s.textContent = p;
      el.appendChild(s);
    });
    return Array.from(el.querySelectorAll(".w"));
  }
  function blurIn(tl, els, t, o) {
    o = o || {};
    tl.fromTo(els, { opacity: o.from ?? 0, filter: "blur(" + (o.blur ?? 8) + "px)" },
      { opacity: 1, filter: "blur(0px)", duration: o.duration ?? 0.14, stagger: o.stagger ?? 0.08, ease: "power2.out" }, t);
  }
  // Decimal places a value is shown with: as many as String(value) has, capped at 1 (stories allow one).
  function decimals(value) {
    const frac = String(value).split(".")[1] || "";
    return Math.min(1, frac.length);
  }
  // A value as it lands: thousands separators and at most one decimal place, cut (never rounded) from String(value),
  // so 99.95 reads "99.9" and never "100.0".
  function numText(value) {
    const str = String(value);
    const neg = str.startsWith("-");
    const [int, frac = ""] = str.replace("-", "").split(".");
    const d = decimals(value);
    return (neg ? "-" : "") + Number(int).toLocaleString("en-US") + (d ? "." + frac.slice(0, d) : "");
  }
  // Where a counter's roll starts: 0 for values under 100 (a short climb reads as counting); from 100 up, the smallest
  // number with as many whole digits as the value (4,812 -> 1,000, -126 -> -100), so the rolling figure is as wide as
  // the landed one.
  function rollFrom(value) {
    if (Math.abs(value) < 100) return 0;
    const digits = String(Math.trunc(Math.abs(value))).length;
    return Math.sign(value) * Math.pow(10, digits - 1);
  }
  // Rolls el's text from `from` to `to`; the landed frame always reads numText(to) exactly.
  function roll(tl, el, from, to, t, dur, places) {
    const d = places ?? decimals(to);
    const o = { v: from };
    const fmt = (v) => (v === to ? numText(to) : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
    el.textContent = fmt(from);
    tl.to(o, { v: to, duration: dur, ease: "power3.out", onUpdate: () => { el.textContent = fmt(d ? o.v : Math.round(o.v)); } }, t);
  }
  // Size one-line text to fit width w px: at most `max` px, never below 28 px. Measures the text at `max` (HyperFrames
  // loads fonts before scene scripts run; width scales linearly with size); k, the average glyph width in em, is only
  // the fallback when nothing can be measured. With o.wrap, text that is still too wide at 28 px may break onto more
  // lines (anywhere, centred) inside w rather than overflow.
  function fit(el, max, w, k, o) {
    el.style.fontSize = max + "px";
    const range = document.createRange();
    range.selectNodeContents(el);
    const measured = range.getBoundingClientRect().width;
    const width = measured > 0 ? measured : Math.max(1, el.textContent.length) * k * max;
    const size = Math.floor((max * w) / width);
    el.style.fontSize = Math.max(28, Math.min(max, size)) + "px";
    if (size < 28 && o && o.wrap) Object.assign(el.style, { whiteSpace: "normal", overflowWrap: "anywhere", maxWidth: w + "px", textAlign: "center" });
  }
  // Size wrapping text to at most `lines` lines inside a box w px wide: the largest size from `max` down (2 px steps,
  // never below 28) at which no word sticks out and the text takes at most `lines` lines. Reads real layout (offset
  // sizes, so transforms never count); call it before any tween touches the element. Pair with `text-wrap: balance`.
  // With o.breakBelow, text that only fits whole words below that size breaks anywhere instead (a long word with no
  // spaces wraps at a large size rather than shrinking to a sliver).
  function fitLines(el, max, w, lines, o) {
    Object.assign(el.style, { width: w + "px", maxWidth: w + "px", whiteSpace: "normal" });
    const fits = (s) => {
      el.style.fontSize = s + "px";
      const lh = parseFloat(getComputedStyle(el).lineHeight) || s * 1.2;
      return el.scrollWidth <= w + 1 && Math.round(el.offsetHeight / lh) <= lines;
    };
    const floor = o && o.breakBelow ? o.breakBelow : 28;
    for (let s = max; s >= floor; s -= 2) if (fits(s)) return s;
    el.style.overflowWrap = "anywhere";
    for (let s = max; s >= 28; s -= 2) if (fits(s)) return s;
    el.style.fontSize = "28px";
    return 28;
  }
  function type(tl, el, t, perChar) {
    const n = el.textContent.length;
    el.style.display = "inline-block"; el.style.overflow = "hidden"; el.style.whiteSpace = "nowrap"; el.style.verticalAlign = "bottom";
    tl.fromTo(el, { width: 0 }, { width: n + "ch", duration: Math.min(1.6, n * perChar), ease: "steps(" + n + ")" }, t);
  }
  // An element's centre in the root's own pixels, from layout offsets (transforms, which GSAP may already have set, are ignored).
  function centre(el, R) {
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2, n = el;
    while (n && n !== R) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x, y };
  }

  // ---------- ui camera (pure geometry: no DOM, so it is unit-tested) ----------
  // Frame px at identity; a shot is { x, y, scale }: translate then scale about the frame's top-left.
  const cam = (() => {
    const SAFE = 40, BAR = 54;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    // Between lo and hi; when lo > hi (a box wider than the room it must stay in) anywhere in [hi, lo], so the box
    // spans the room instead of being forced to its centre.
    const within = (v, lo, hi) => (lo <= hi ? clamp(v, lo, hi) : clamp(v, hi, lo));
    // The 1460 x 860 window: wide at 1:1, tall at 960/1460, centred across (tall: centred at 47% of the height).
    function geometry(W, H) {
      const wide = W > H, K = wide ? 1 : 960 / 1460, WW = 1460 * K, WH = 860 * K;
      return { W, H, wide, K, WW, WH, BAR, wx: Math.round((W - WW) / 2), wy: Math.round(wide ? (H - WH) / 2 : H * 0.47 - WH / 2) };
    }
    // A focus box (image px, or screen CSS px when view.scale is 1) as a frame rect at identity.
    const rect = (g, view, box) => ({ x: g.wx + g.K * (view.x + box[0] * view.scale), y: g.wy + g.K * (g.BAR + view.y + box[1] * view.scale), w: g.K * box[2] * view.scale, h: g.K * box[3] * view.scale });
    // Puts r's centre at (cx, cy) at scale s; the window keeps covering the frame where it is big enough, but the box
    // stays inside the side margins and [y0, y1].
    function shot(g, r, s, cx, cy, y0, y1) {
      let x = cx - s * (r.x + r.w / 2), y = cy - s * (r.y + r.h / 2);
      if (s * g.WW >= g.W) x = clamp(x, g.W - s * (g.wx + g.WW), -s * g.wx);
      if (s * g.WH >= g.H) y = clamp(y, g.H - s * (g.wy + g.WH), -s * g.wy);
      x = within(x, SAFE - s * r.x, g.W - SAFE - s * (r.x + r.w));
      y = within(y, y0 - s * r.y, y1 - s * (r.y + r.h));
      return { x, y, scale: s };
    }
    const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    // A rect cut by every box that clips it (overflow not visible, and the window body), or null if nothing shows.
    function clip(rc, clips) {
      let x0 = rc.x, y0 = rc.y, x1 = rc.x + rc.w, y1 = rc.y + rc.h;
      for (const c of clips) { x0 = Math.max(x0, c.x); y0 = Math.max(y0, c.y); x1 = Math.min(x1, c.x + c.w); y1 = Math.min(y1, c.y + c.h); }
      return x1 - x0 > 0.5 && y1 - y0 > 0.5 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    }
    // A box grown until it cuts no text box: each text box it overlaps but does not hold is taken whole, but never
    // past bound (the window body), so the camera stays on the product.
    function widen(box, texts, bound) {
      let b = { ...box };
      for (let pass = 0; pass < 12; pass++) {
        const cut = texts.find((t) => overlaps(t, b) && !inside(t, b));
        if (!cut) break;
        const x0 = Math.min(b.x, cut.x), y0 = Math.min(b.y, cut.y);
        b = { x: x0, y: y0, w: Math.max(b.x + b.w, cut.x + cut.w) - x0, h: Math.max(b.y + b.h, cut.y + cut.h) - y0 };
      }
      return bound ? clip(b, [bound]) || box : b;
    }
    // Moves a shot the least it can (up to 120 px each way) so that no frame edge cuts a text box, keeping the box
    // where it was allowed to be. Text boxes are frame rects at identity.
    function clean(g, sh, texts, box, y0, y1) {
      if (!texts.length) return sh;
      const s = sh.scale;
      const on = (t) => ({ x: sh.x + s * t.x, y: sh.y + s * t.y, w: s * t.w, h: s * t.h });
      const best = (axis) => {
        const [lo, hi, size, other, osize, edge] = axis === "x" ? ["x", "w", g.W, "y", "h", g.H] : ["y", "h", g.H, "x", "w", g.W];
        const shown = texts.map(on).filter((t) => t[other] < edge && t[other] + t[osize] > 0);
        const boxOn = on(box);
        const [bmin, bmax] = axis === "x" ? [SAFE, g.W - SAFE] : [y0, y1];
        const boxFits = boxOn[hi] <= bmax - bmin;
        const cuts = (d) => shown.filter((t) => (t[lo] + d < 0 && t[lo] + t[hi] + d > 0) || (t[lo] + d < size && t[lo] + t[hi] + d > size)).length;
        let pick = 0, fewest = cuts(0);
        for (let k = 1; k <= 60 && fewest > 0; k++) {
          for (const d of [2 * k, -2 * k]) {
            const b0 = boxOn[lo] + d, b1 = b0 + boxOn[hi];
            if (boxFits && (b0 < bmin - 1e-6 || b1 > bmax + 1e-6)) continue;
            const c = cuts(d);
            if (c < fewest) { fewest = c; pick = d; }
          }
        }
        return pick;
      };
      return { x: sh.x + best("x"), y: sh.y + best("y"), scale: s };
    }
    // The push to one focus box. Wide: the box fills at most 80% of the width and fits under the chip (scale 1.2 to
    // 2.6), centred. Tall: framed by height (the box about half the frame); a box then wider than the frame is panned,
    // from its left edge to its right edge, while it holds. band = { top, bottom }: where the box may sit.
    function focus(g, r, texts, band) {
      const room = band.bottom - band.top;
      if (g.wide) {
        const s = clamp(Math.min((0.8 * g.W) / r.w, (0.9 * room) / r.h), 1.2, 2.6);
        return { from: clean(g, shot(g, r, s, g.W / 2, g.H / 2, band.top, band.bottom), texts, r, band.top, band.bottom), to: null };
      }
      const s = clamp(Math.min((0.5 * g.H) / r.h, (0.9 * room) / r.h), 1.2, 2.6);
      const cy = (band.top + band.bottom) / 2;
      if (s * r.w <= g.W - 2 * SAFE) return { from: clean(g, shot(g, r, s, g.W / 2, cy, band.top, band.bottom), texts, r, band.top, band.bottom), to: null };
      const at = (cx) => clean(g, shot(g, r, s, cx, cy, band.top, band.bottom), texts, r, band.top, band.bottom);
      return { from: at(SAFE + (s * r.w) / 2), to: at(g.W - SAFE - (s * r.w) / 2) };
    }
    // The caption view: 10% back from where the last push ended, the box lifted between the chip and the caption.
    function backShot(g, r, last, texts, band) {
      const s = Math.max(1, Math.min(last.scale * 0.9, (0.95 * (band.bottom - band.top)) / r.h));
      const wider = s * r.w > g.W - 2 * SAFE;
      // Tall, still wider than the frame: stay on the side the pan ended on.
      const cx = !g.wide && wider ? g.W - SAFE - (s * r.w) / 2 : g.W / 2;
      return clean(g, shot(g, r, s, cx, (band.top + band.bottom) / 2, band.top, band.bottom), texts, r, band.top, band.bottom);
    }
    // When the caption ease-back starts and how long it runs: at rest by end - 0.45, when the exits take over.
    const back = (captionAt, end) => ({ t: captionAt - 0.15, duration: Math.max(0.2, Math.min(0.7, end - 0.45 - (captionAt - 0.15))) });
    // Which end of a pan ("from" or "to") shows more of rect, the part of the screen that acts.
    function aim(g, p, rc) {
      const area = (sh) => {
        const x0 = Math.max(0, sh.x + sh.scale * rc.x), x1 = Math.min(g.W, sh.x + sh.scale * (rc.x + rc.w));
        const y0 = Math.max(0, sh.y + sh.scale * rc.y), y1 = Math.min(g.H, sh.y + sh.scale * (rc.y + rc.h));
        return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
      };
      return p.to && area(p.to) > area(p.from) ? "to" : "from";
    }
    return { SAFE, geometry, rect, shot, clip, widen, clean, focus, backShot, back, aim };
  })();

  // ---------- transitions (built inside each scene; the next scene starts T before this one ends) ----------
  function content(S) { return S.qa(":scope > :not(.scene-data):not(.ground):not(script):not(style)"); }
  function transIn(S) {
    const { tl, R, D, W, H, wide } = S;
    switch (D.in) {
      case "whip": {
        // The new world slams in from below (wide) or the right (tall) and sharpens as it lands. The ground is a clip-path
        // wipe, not a transform: HyperFrames' motion blur crops a moving element at the frame border, which leaves a soft
        // seam where a full-frame panel meets it. The content rides in on the CSS `translate` property (driven by a
        // variable), so it never fights the scene's own GSAP transforms of the same elements.
        const els = content(S);
        els.forEach((el) => { el.style.translate = wide ? "0 var(--rr-whip)" : "var(--rr-whip) 0"; });
        tl.fromTo(R, { clipPath: wide ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 0% 100%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: T, ease: "expo.out" }, 0);
        tl.fromTo(R, { "--rr-whip": (wide ? H : W) * 0.7 + "px" }, { "--rr-whip": "0px", duration: T, ease: "expo.out" }, 0);
        tl.fromTo(els, { filter: "blur(8px)" }, { filter: "blur(0px)", duration: T, ease: "power2.out" }, 0);
        if (D.prevGround && D.prevGround === D.ground) {
          // Same ground on both sides: the wipe itself would be invisible, so an accent bar rides its edge (a .ground
          // layer, so the transitions leave it alone) and fades as the wipe settles.
          const bar = document.createElement("div");
          bar.className = "ground rr-edge";
          bar.setAttribute("data-layout-ignore", "");
          bar.setAttribute("aria-hidden", "true");
          Object.assign(bar.style, { position: "absolute", left: "0", top: "0", background: "var(--accent-ink)", zIndex: "40", pointerEvents: "none" },
            wide ? { width: "100%", height: "40px" } : { width: "40px", height: "100%" });
          R.appendChild(bar);
          tl.fromTo(bar, { [wide ? "y" : "x"]: wide ? H : W }, { [wide ? "y" : "x"]: -40, duration: T, ease: "expo.out" }, 0)
            .fromTo(bar, { opacity: 1 }, { opacity: 0, duration: 0.12, ease: "power1.in", immediateRender: false }, T - 0.17);
        }
        break;
      }
      case "flood": {
        // The new ground rises as a dome from below the frame (a circle centred under the bottom edge, so it never
        // opens as a hole in the middle of the outgoing text) until it reaches the top corners; the new content
        // sharpens on it almost at once. filter opacity() leaves the elements' own opacity free for the scene.
        const r = Math.ceil(Math.hypot(W / 2, H * 1.2) * 1.02);
        tl.fromTo(R, { clipPath: "circle(0px at 50% 120%)" }, { clipPath: "circle(" + r + "px at 50% 120%)", duration: 0.4, ease: "power2.inOut" }, 0);
        tl.fromTo(content(S), { filter: "blur(16px) opacity(0)" }, { filter: "blur(0px) opacity(1)", duration: 0.25, ease: "power2.out" }, 0.04);
        break;
      }
      case "zoom":
        // Hidden until the outgoing scene's dot has covered the frame in this scene's ground (or, on the same ground,
        // its camera has dived): shown on the last frame the outgoing scene paints, so no frame falls between them.
        tl.fromTo(R, { opacity: 0 }, { opacity: 0, duration: 0.001 }, 0).set(R, { opacity: 1 }, T - 0.045);
        tl.fromTo(content(S), { filter: "blur(12px)" }, { filter: "blur(0px)", duration: 0.3, ease: "power2.out" }, T - 0.045);
        break;
      case "carry":
        // Built underneath the outgoing scene (the builder puts a carry's host above the next one), which clears its
        // ground around its hero: this scene is there from the first frame and sharpens as it is uncovered.
        tl.fromTo(content(S), { filter: "blur(8px)" }, { filter: "blur(0px)", duration: 0.25, ease: "power2.out" }, 0.1);
        break;
      case "blur":
        // A blur dissolve is short (0.1 s): between a dark and a light scene its midpoint is a flat grey with no ink.
        tl.fromTo(R, { opacity: 0 }, { opacity: 1, duration: 0.1, ease: "power2.out" }, 0);
        tl.fromTo(content(S), { filter: "blur(8px)" }, { filter: "blur(0px)", duration: 0.2, ease: "power2.out" }, 0.1);
        break;
      default: break; // first scene: no entrance transition
    }
  }
  function transOut(S) {
    const { tl, R, D, W, H, wide } = S;
    const end = D.duration;
    const hero = S.q(".hero") || content(S)[0];
    switch (D.out) {
      case "whip":
        // Leaves under the next scene's wipe (which starts at end - T and covers most of the frame in its first 0.1 s),
        // so the frame is never empty between them. HyperFrames' motion blur redraws a moving element above later
        // scenes, so the leaving content opts out of it (its own blur filter smears it instead) and stays beneath the
        // wipe; it fades once the wipe has all but covered it.
        const els = content(S);
        tl.set(els, { attr: { "data-motion-blur": "off" } }, end - T - 0.05)
          .fromTo(els, { filter: "blur(0px)" },
            { [wide ? "yPercent" : "xPercent"]: -60, filter: "blur(18px)", duration: 0.24, ease: "power3.in", immediateRender: false }, end - T)
          .to(els, { opacity: 0, duration: 0.14, ease: "power1.in" }, end - T + 0.08);
        break;
      case "blur":
        tl.to(content(S), { opacity: 0, filter: "blur(8px)", duration: 0.18, ease: "power2.in" }, end - T);
        break;
      case "carry": {
        // This scene stays on top of the next one (the builder raises a carry's host): from end - T its ground and
        // everything but the hero fade away, so the next scene builds around the hero as it shrinks and slides out.
        // The hero fades only over the last 0.1 s. It opts out of motion blur, which would redraw it as a second copy.
        const path = new Set();
        for (let n = hero; n && n !== R; n = n.parentElement) path.add(n);
        const others = [];
        path.forEach((n) => { for (const sib of Array.from(n.parentElement.children)) if (!path.has(sib) && !sib.matches("script, style")) others.push(sib); });
        const [r, g, b] = rgb(D.ground);
        tl.set(hero, { attr: { "data-motion-blur": "off" } }, end - 0.45)
          .to(hero, { scale: 0.6, xPercent: -45, filter: "blur(4px)", duration: 0.4, ease: "power2.in" }, end - 0.4)
          .to(hero, { opacity: 0, duration: 0.1, ease: "power1.in" }, end - 0.1)
          .fromTo(R, { backgroundColor: D.ground }, { backgroundColor: "rgba(" + r + "," + g + "," + b + ",0)", duration: 0.15, ease: "power1.out", immediateRender: false }, end - T);
        if (others.length) tl.to(others, { opacity: 0, filter: "blur(8px)", duration: 0.15, ease: "power1.out" }, end - T);
        break;
      }
      case "zoom": {
        const target = S.q("[data-zoom-target]") || hero;
        const { x: cx, y: cy } = centre(target, R);
        const cam = S.q(".cam") || R;
        // The dive starts at once (power2.in) and blurs as it speeds up: a filter, not HyperFrames' motion blur, which
        // would redraw the camera above the layers in front of it (a ui scene's chip and caption, the disc).
        tl.to(cam, { scale: 3, transformOrigin: cx + "px " + cy + "px", duration: 0.45, ease: "power2.in" }, end - 0.45);
        tl.fromTo(cam, { filter: "blur(0px)" }, { filter: "blur(10px)", duration: 0.3, ease: "power2.in", immediateRender: false }, end - 0.3);
        const disc = target.getAttribute("data-zoom-disc");
        if (disc) {
          // The target's own colour floods the frame (the green-tick move): a disc the size and colour of the target,
          // on it from end - 0.3 (the tick itself growing, as in the prototype), covers the frame by end - 0.09 and
          // turns into the next ground over end - 0.15 -> end - 0.045 (the next scene is shown from end - 0.045), so the
          // change of colour is seen, not cut.
          const r = Math.max(4, Math.max(target.offsetWidth, target.offsetHeight) / 2);
          // Full size reaches the frame corner farthest from the disc's centre (by end - 0.09).
          const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
          const dot = document.createElement("div");
          dot.className = "zoom-dot";
          dot.setAttribute("data-layout-ignore", "");
          // A crisp disc: motion blur's capture of a fast-growing layer let parts of the screen show through it.
          dot.setAttribute("data-motion-blur", "off");
          Object.assign(dot.style, { position: "absolute", left: cx - r + "px", top: cy - r + "px", width: 2 * r + "px", height: 2 * r + "px", borderRadius: "50%", background: disc, opacity: "0", zIndex: "50", pointerEvents: "none" });
          R.appendChild(dot);
          // Once the disc is on, the diving camera opts out of motion blur: HyperFrames' capture would otherwise
          // redraw parts of it, sharp, above the disc.
          tl.set(cam, { attr: { "data-motion-blur": "off" } }, end - 0.3)
            .set(dot, { opacity: 1 }, end - 0.3)
            .fromTo(dot, { scale: 1 }, { scale: (far / r) * 1.02, duration: 0.21, ease: "power3.in", immediateRender: false }, end - 0.3)
            .fromTo(dot, { backgroundColor: disc }, { backgroundColor: D.nextGround || disc, duration: 0.105, ease: "power1.inOut", immediateRender: false }, end - 0.15);
          break;
        }
        // Into the same ground a dot would only read as a hole: the camera dives and the next scene sharpens in.
        if (D.nextGround === D.ground) break;
        // The dot starts at 0.6 x the target's larger side and only once the camera is moving fast (end - 0.22, under
        // its blur); it fades in over 0.06 s and grows past the frame's corners at once, so it reads as the next ground
        // swallowing the target rather than a hole punched in it.
        const r = Math.max(30, Math.round(0.3 * Math.max(target.offsetWidth, target.offsetHeight)));
        const dot = document.createElement("div");
        dot.className = "zoom-dot";
        dot.setAttribute("data-layout-ignore", "");
        Object.assign(dot.style, { position: "absolute", left: cx - r + "px", top: cy - r + "px", width: 2 * r + "px", height: 2 * r + "px", borderRadius: "50%", background: D.nextGround, opacity: "0", zIndex: "50", pointerEvents: "none" });
        R.appendChild(dot);
        tl.fromTo(dot, { opacity: 0 }, { opacity: 1, duration: 0.06, ease: "none", immediateRender: false }, end - 0.22)
          .fromTo(dot, { scale: 1 }, { scale: Math.ceil((Math.hypot(W, H) / r) * 1.1), duration: 0.22, ease: "power2.in", immediateRender: false }, end - 0.22);
        break;
      }
      default: break; // flood, or the last scene: hold
    }
  }
  return { T, scene, words, blurIn, roll, rollFrom, decimals, numText, fit, fitLines, type, centre, readable, contrast, cam };
})();
