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
  function roll(tl, el, from, to, t, dur, decimals) {
    const o = { v: from };
    const fmt = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: decimals || 0, maximumFractionDigits: decimals || 0 });
    el.textContent = fmt(from);
    tl.to(o, { v: to, duration: dur, ease: "power3.out", onUpdate: () => { el.textContent = fmt(decimals ? o.v : Math.round(o.v)); } }, t);
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
  function fitLines(el, max, w, lines) {
    Object.assign(el.style, { width: w + "px", maxWidth: w + "px", whiteSpace: "normal" });
    for (let s = max; s >= 28; s -= 2) {
      el.style.fontSize = s + "px";
      const lh = parseFloat(getComputedStyle(el).lineHeight) || s * 1.2;
      if (el.scrollWidth <= w + 1 && Math.round(el.offsetHeight / lh) <= lines) return s;
    }
    el.style.fontSize = "28px";
    el.style.overflowWrap = "anywhere";
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
        tl.fromTo(els, { filter: "blur(16px)" }, { filter: "blur(0px)", duration: T, ease: "power2.out" }, 0);
        break;
      }
      case "flood":
        // The new ground grows from the centre first (75% reaches the corners), then the new content sharpens on it.
        // filter opacity() leaves the elements' own opacity free for the scene to animate.
        tl.fromTo(R, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(75% at 50% 50%)", duration: 0.4, ease: "power2.inOut" }, 0);
        tl.fromTo(content(S), { filter: "blur(16px) opacity(0)" }, { filter: "blur(0px) opacity(1)", duration: 0.25, ease: "power2.out" }, 0.18);
        break;
      case "zoom":
        // Hidden until the outgoing scene's dot has covered the frame in this scene's ground.
        tl.fromTo(R, { opacity: 0 }, { opacity: 0, duration: 0.001 }, 0).set(R, { opacity: 1 }, T - 0.01);
        tl.fromTo(content(S), { filter: "blur(12px)" }, { filter: "blur(0px)", duration: 0.3, ease: "power2.out" }, T - 0.01);
        break;
      case "carry":
      case "blur":
        tl.fromTo(R, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "power2.out" }, D.in === "carry" ? 0.15 : 0);
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
        // Leaves just before the next scene lands, as in the prototype (out at 0.62 s, in at 0.74 s), and fades as it
        // goes: HyperFrames' motion blur paints a moving element above later scenes, so it must be gone, not covered.
        tl.fromTo(content(S), { filter: "blur(0px)" },
          { [wide ? "yPercent" : "xPercent"]: -60, filter: "blur(18px)", duration: 0.22, ease: "power3.in", immediateRender: false }, end - T - 0.12)
          .to(content(S), { opacity: 0, duration: 0.15, ease: "power1.in" }, end - T - 0.1);
        break;
      case "blur":
        tl.to(content(S), { opacity: 0, filter: "blur(8px)", duration: 0.18, ease: "power2.in" }, end - T);
        break;
      case "carry":
        tl.to(hero, { scale: 0.6, xPercent: -45, opacity: 0, filter: "blur(6px)", duration: 0.38, ease: "power3.in" }, end - 0.4);
        break;
      case "zoom": {
        const target = S.q("[data-zoom-target]") || hero;
        const { x: cx, y: cy } = centre(target, R);
        const dot = document.createElement("div");
        dot.className = "zoom-dot";
        dot.setAttribute("data-layout-ignore", "");
        Object.assign(dot.style, { position: "absolute", left: cx - 30 + "px", top: cy - 30 + "px", width: "60px", height: "60px", borderRadius: "50%", background: D.nextGround, opacity: "0", zIndex: "50", pointerEvents: "none" });
        R.appendChild(dot);
        const cam = S.q(".cam") || R;
        tl.to(cam, { scale: 3, transformOrigin: cx + "px " + cy + "px", duration: 0.45, ease: "power3.in" }, end - 0.45)
          .set(dot, { opacity: 1 }, end - 0.3)
          .fromTo(dot, { scale: 1 }, { scale: Math.ceil((Math.hypot(W, H) / 30) * 1.1), duration: 0.3, ease: "power3.in" }, end - 0.3);
        break;
      }
      default: break; // flood, or the last scene: hold
    }
  }
  return { T, scene, words, blurIn, roll, fit, fitLines, type, centre, readable, contrast };
})();
