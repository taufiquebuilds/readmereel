// Cleans and scopes an agent-rebuilt HTML screen before it goes into a film.
//
// Approach: the HTML is tokenised by a small parser that follows the HTML
// tokenizer rules for tag names, attributes, comments and raw-text elements,
// and the markup is then REBUILT from the parsed pieces. Everything is an
// allowlist: element names (by context: HTML, or SVG inside <svg>), attribute
// names per element (data-* only for the ui template's hooks) and their values.
// An open-element stack keeps the output balanced: stray end tags are dropped,
// the closes the browser would imply are written out, table parts appear only
// where the browser takes them as written, and everything is closed at the end,
// so a screen can neither close its wrapper nor swallow what follows it. Ids are
// prefixed with the scope and template class names are removed.
// CSS: comments stripped, escapes normalised, no at-rules and no nested rules,
// every url() re-written to a checked canonical form, every function name in a
// value checked against an allowlist after full escape decoding, every selector
// scoped and checked to stay inside the screen, position:fixed/sticky made
// absolute, and a final scan that fails closed (strings terminated, brackets
// balanced, no function outside the allowlists).
//
// Size and cost: input over 256 KB is refused, open elements are capped at a depth of 256, and every scan is
// either linear or bounded by that depth, so no input can make the sanitizer slow.
//
// No dependencies. This is a defence for generated demo screens that are
// rendered to video, not a general-purpose sanitiser for untrusted web pages.

const REJECTED_AT_RULE = (name) => new Error(`screen: @${name} is not allowed`);

// A rebuilt demo screen is a few KB; anything this large is refused before it is parsed.
const MAX_BYTES = 256 * 1024;
// Open elements deeper than this are dropped (their text is kept), so every walk over the open-element stack is short.
const MAX_DEPTH = 256;
// Distinct local images one screen may use; one more refuses the screen.
export const MAX_IMAGES = 64;

// An error that refuses the whole screen, even where a bad style attribute would only be dropped.
const fatal = (message) => Object.assign(new Error(message), { fatal: true });

// ---------------------------------------------------------------- allowlists

// Only these elements are kept. Anything else loses its tag but keeps its text, except the elements below whose
// content is dropped with them. SVG names are emitted in their canonical case.
const HTML_ELEMENTS = new Set([
  "div", "span", "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "section", "header", "footer", "main", "nav",
  "aside", "article", "figure", "figcaption", "strong", "em", "b", "i", "u", "small", "code", "pre", "kbd", "mark", "sup",
  "sub", "br", "hr", "img", "button", "label", "a", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
]);
const SVG_ELEMENTS = new Map([
  "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "linearGradient",
  "radialGradient", "stop", "clipPath", "mask", "use", "title",
].map((n) => [n.toLowerCase(), n]));
const VOID = new Set(["br", "hr", "img"]);
// Raw-text elements: their content is text for the browser, so it is skipped up to the matching end tag.
// (<style> is extracted, never emitted.)
const RAW_TEXT = new Set(["script", "style", "iframe", "noembed", "noframes", "noscript", "xmp", "textarea", "title", "plaintext"]);
// Removed together with everything inside them.
const DROP_WITH_CONTENT = new Set([
  "object", "form", "template", "applet", "frameset", "portal", "video", "audio", "math", "select", "foreignobject",
]);
const DOCUMENT = new Set(["html", "head", "body"]);

// Table parts only where the browser takes them as written (no foster parenting, no implied cells or rows).
const TABLE_CONTEXT = new Set(["table", "thead", "tbody", "tfoot", "tr"]);
const SECTIONS = new Set(["thead", "tbody", "tfoot"]);
// Start tags that make the browser close an open <p> in button scope (the allowlisted part of the HTML spec's list).
const CLOSES_P = new Set([
  "article", "aside", "div", "figcaption", "figure", "footer", "header", "main", "nav", "ol", "p", "section", "ul",
  "h1", "h2", "h3", "h4", "h5", "h6", "pre", "li", "table", "hr",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BUTTON_SCOPE = new Set(["button", "table", "td", "th"]);
// "Special" elements that stop the browser's search for an open <li>.
const SPECIAL = new Set([
  "article", "aside", "button", "div", "figcaption", "figure", "footer", "header", "main", "nav", "ol", "p", "pre", "section",
  "ul", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6",
]);

const GENERAL_ATTRS = new Set(["class", "id", "style", "title", "alt", "width", "height", "role", "colspan", "rowspan"]);
// The ui template's state hooks; no other data-* attribute is kept (HyperFrames reads data-composition-src, data-start ...).
const DATA_ATTRS = new Set(["data-pop", "data-was", "data-now"]);
const ARIA_IDREFS = new Set(["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-details", "aria-errormessage", "aria-flowto"]);
const SVG_ATTRS = new Map([
  "viewBox", "d", "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "stroke-miterlimit", "opacity", "cx", "cy", "r", "rx", "ry",
  "fx", "fy", "x", "y", "dx", "dy", "x1", "y1", "x2", "y2", "points", "transform", "gradientUnits", "gradientTransform",
  "offset", "stop-color", "stop-opacity", "clip-path", "clip-rule", "mask", "preserveAspectRatio", "text-anchor",
  "dominant-baseline", "font-size", "font-family", "font-weight",
].map((n) => [n.toLowerCase(), n]));
// Presentation attributes are parsed as CSS: a plain character set leaves no room for escapes, comments or strings.
const SVG_VALUE = /^[A-Za-z0-9 \t\n#%.,()+_-]*$/;
const URL_ATTRS = new Set(["fill", "stroke", "clip-path", "mask"]);
const FRAGMENT_URL = /url\(\s*#([A-Za-z0-9_-]+)\s*\)/gi;
const ID = /^[A-Za-z0-9_-]+$/;
// Names the scene templates and the runtime use; a screen may not wear them.
const RESERVED_CLASS = new Set(["root", "scene-data", "clip", "hero", "cam"]);
const RESERVED_CLASS_PREFIX = /^(?:hook|title|ui|terminal|counter|compare|list|end|zoom|screen)-/;
const IMAGE_FILE = /\.(?:png|jpe?g|gif|webp|svg)$/i;

// The CSS functions a value may call, by name after full escape decoding, in lower case and without a vendor prefix
// (-webkit-linear-gradient is linear-gradient). None of them loads anything. url() is not here: it is allowed only as
// the exact name "url", and rewriteUrls turns every url() into a checked local image, data image or #fragment.
// Anything else (image-set, cross-fade, element, paint, src, image, attr, env, anchor ...) drops the declaration.
const VALUE_FUNCTIONS = new Set([
  "rgb", "rgba", "hsl", "hsla", "hwb", "lab", "lch", "oklab", "oklch", "color", "color-mix", "light-dark",
  "calc", "min", "max", "clamp", "round", "mod", "rem", "abs", "sign", "var",
  "linear-gradient", "radial-gradient", "conic-gradient", "repeating-linear-gradient", "repeating-radial-gradient",
  "repeating-conic-gradient",
  "translate", "translatex", "translatey", "translatez", "translate3d", "rotate", "rotatex", "rotatey", "rotatez",
  "rotate3d", "scale", "scalex", "scaley", "scalez", "scale3d", "skew", "skewx", "skewy", "matrix", "matrix3d", "perspective",
  "cubic-bezier", "steps", "linear",
  "blur", "brightness", "contrast", "drop-shadow", "grayscale", "hue-rotate", "invert", "opacity", "saturate", "sepia",
  "minmax", "repeat", "fit-content",
  "counter", "counters", "inset", "circle", "ellipse", "polygon", "rect", "xywh",
]);
// Functional pseudo-classes and pseudo-elements, allowed in the final scan only right after ":".
const PSEUDO_FUNCTIONS = new Set([
  "not", "is", "where", "has", "nth-child", "nth-last-child", "nth-of-type", "nth-last-of-type", "lang", "dir",
  "-webkit-any", "-moz-any", "matches", "part", "highlight",
]);
const allowedFunction = (name) => {
  const lower = name.toLowerCase();
  return lower === "url" || VALUE_FUNCTIONS.has(lower.replace(/^-[a-z]+-/, ""));
};

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: "\t", newline: "\n", nbsp: "\u00a0",
  sol: "/", bsol: "\\", lpar: "(", rpar: ")", period: ".", comma: ",", semi: ";", equals: "=", num: "#",
  percnt: "%", lsqb: "[", rsqb: "]", lbrack: "[", rbrack: "]", lcub: "{", rcub: "}", excl: "!", quest: "?",
  plus: "+", hyphen: "-", dash: "-", lowbar: "_", grave: "`", commat: "@", dollar: "$", ast: "*", midast: "*",
};

function decodeEntities(s) {
  // Single pass: "&amp;colon;" becomes the text "&colon;", never ":". Anything
  // not recognised stays as typed and is escaped again on the way out, so the
  // browser sees it as plain text.
  return s.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]*));?/g, (whole, dec, hex, name) => {
    if (name !== undefined) return Object.hasOwn(NAMED_ENTITIES, name.toLowerCase()) ? NAMED_ENTITIES[name.toLowerCase()] : whole;
    const cp = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return "\ufffd";
    return String.fromCodePoint(cp);
  });
}

export const escAttr = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escText = (s) => s.replace(/</g, "&lt;");

// ------------------------------------------------------------------ URLs

// Judges one URL the way a browser would read it. Returns
// { ok, kind: "fragment" | "local" | "data", value } or { ok: false }.
function classifyUrl(raw) {
  // Browsers drop leading/trailing control characters and spaces, and tabs and
  // newlines anywhere. The kept value is exactly that; the probe is stricter
  // still (all invisible characters removed) so look-alikes are caught.
  const v = String(raw).replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "").replace(/[\t\n\r]/g, "");
  const probe = String(raw).replace(/[\u0000-\u0020\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, "").toLowerCase();
  if (v === "" || probe === "") return { ok: false, why: "empty" };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, why: "control characters" };
  if (probe[0] === "#") return v[0] === "#" ? { ok: true, kind: "fragment", value: v } : { ok: false, why: "odd fragment" };
  if (/^[a-z][a-z0-9+.\-]*:/.test(probe)) {
    if (/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]*$/.test(probe)) {
      return { ok: true, kind: "data", value: String(raw).replace(/\s+/g, "") };
    }
    return { ok: false, why: `${probe.slice(0, probe.indexOf(":") + 1)} URL` };
  }
  if (probe[0] === "/" || probe[0] === "\\") return { ok: false, why: "outside URL" };
  if (v.includes("\\")) return { ok: false, why: "backslash in path" };
  let decoded;
  try { decoded = decodeURIComponent(v); } catch { return { ok: false, why: "bad escape in path" }; }
  if (/[\u0000-\u001f\u007f]/.test(decoded) || decoded.split(/[/\\]/).includes("..")) return { ok: false, why: "path leaves the project" };
  return { ok: true, kind: "local", value: v };
}

// A local value that will be copied as a file must be a plain path to an image file.
const isImageFile = (v) => !/[?#]/.test(v) && IMAGE_FILE.test(v);

// ------------------------------------------------------------------ CSS text

// Ends a string that starts at s[i] (a quote). An unescaped newline ends it
// too (bad-string), exactly like a browser, so what follows is still live.
function skipString(s, i) {
  const q = s[i];
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === q) return j + 1;
    if (c === "\n" || c === "\f" || c === "\r") return j;
    j++;
  }
  return s.length;
}

const IDENT_CHAR = /[A-Za-z0-9_\-\u0080-\uffff]/;

// If an opaque token (string, escape, unquoted url()) starts at i, returns the
// index after it; otherwise i.
function opaqueEnd(s, i) {
  const c = s[i];
  if (c === '"' || c === "'") return skipString(s, i);
  if (c === "\\") return Math.min(s.length, i + 2);
  if ((c === "u" || c === "U") && s.slice(i, i + 4).toLowerCase() === "url(" && (i === 0 || !IDENT_CHAR.test(s[i - 1]))) {
    let j = i + 4;
    while (j < s.length && /\s/.test(s[j])) j++;
    if (s[j] === '"' || s[j] === "'") return i; // quoted: scanned as a normal string
    while (j < s.length && s[j] !== ")") { if (s[j] === "\\") j++; j++; }
    return Math.min(s.length, j + 1);
  }
  return i;
}
const step = (s, i) => { const e = opaqueEnd(s, i); return e > i ? e : i + 1; };

function stripComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '"' || c === "'") { const e = skipString(css, i); out += css.slice(i, e); i = e; }
    else if (c === "\\") { out += css.slice(i, i + 2); i += 2; }
    else if (c === "/" && css[i + 1] === "*") { const e = css.indexOf("*/", i + 2); i = e < 0 ? css.length : e + 2; out += " "; }
    else { out += c; i++; }
  }
  return out;
}

// Turns escaped ASCII letters back into letters (u\72l( -> url(, @\69mport ->
// @import) so keywords can be recognised. Other escapes are kept, in a form
// whose end is explicit, so decoded letters can never glue onto them.
function normaliseEscapes(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"' || c === "'") { const e = skipString(s, i); out += s.slice(i, e); i = e; continue; }
    if (c !== "\\") { out += c; i++; continue; }
    const hex = /^[0-9a-fA-F]{1,6}/.exec(s.slice(i + 1, i + 7));
    if (hex) {
      const cp = parseInt(hex[0], 16);
      let j = i + 1 + hex[0].length;
      if (j < s.length && /[ \t\n\f]/.test(s[j])) j++;
      const ch = cp > 0 && cp < 0x80 ? String.fromCharCode(cp) : "";
      out += /^[A-Za-z]$/.test(ch) ? ch : `\\${hex[0]} `;
      i = j;
    } else if (i + 1 < s.length && s[i + 1] !== "\n") {
      out += /[A-Za-z]/.test(s[i + 1]) ? s[i + 1] : `\\${s[i + 1]}`;
      i += 2;
    } else { out += c; i++; }
  }
  return out;
}

// Full CSS unescape for a URL target.
function cssUnescape(s) {
  return s.replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f]?|\n|([^]))/g, (m, hex, ch) => {
    if (hex) {
      const cp = parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\ufffd" : String.fromCodePoint(cp);
    }
    return ch ?? "";
  });
}

// The character an escape at s[i] ("\") stands for (CSS Syntax 4.3.7: one to six hex digits and one optional
// whitespace, or any other character) and the index after it; null where "\" escapes nothing (before a newline or
// at the end), which the browser reads as a lone "\".
function decodeEscape(s, i) {
  if (i + 1 >= s.length || /[\n\f\r]/.test(s[i + 1])) return null;
  const hex = /^[0-9a-fA-F]{1,6}/.exec(s.slice(i + 1, i + 7));
  if (!hex) return { ch: s[i + 1], end: i + 2 };
  const cp = parseInt(hex[0], 16);
  return { ch: cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff) ? "\ufffd" : String.fromCodePoint(cp), end: escapeEnd(s, i) };
}

const NAME_CHAR = /[A-Za-z0-9_\-\u0080-\uffff]/;

// Every function token in CSS text, the way the browser tokenises it: strings are skipped, and an escape is always
// part of a name whatever it decodes to, so "image\2d set(" and "image\-set(" call image-set and "calc\(" calls
// nothing. Names are returned fully decoded, with the character just before them. The contents of an unquoted url()
// are one token and are skipped. `escapedParen` is set when an escape stands for "(" or ")".
function cssFunctions(s) {
  const found = [];
  let escapedParen = false;
  let name = "";
  let start = 0;
  for (let i = 0; i < s.length;) {
    const c = s[i];
    if (c === '"' || c === "'") { name = ""; i = skipString(s, i); continue; }
    if (c === "\\") {
      const e = decodeEscape(s, i);
      if (!e) { name = ""; i++; continue; }
      if (e.ch === "(" || e.ch === ")") escapedParen = true;
      if (!name) start = i;
      name += e.ch;
      i = e.end;
      continue;
    }
    if (NAME_CHAR.test(c)) { if (!name) start = i; name += c; i++; continue; }
    if (c === "(" && name) {
      found.push({ name, before: s[start - 1] ?? "" });
      i++;
      if (name.toLowerCase() === "url") {
        let j = i;
        while (j < s.length && /\s/.test(s[j])) j++;
        if (s[j] !== '"' && s[j] !== "'") {
          while (j < s.length && s[j] !== ")") j += s[j] === "\\" ? 2 : 1;
          i = j;
        }
      }
      name = "";
      continue;
    }
    name = "";
    i++;
  }
  return { found, escapedParen };
}

export const cssString = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "").replace(/</g, "\\3c ")}"`;

// A lone "\\" at the very end would escape whatever is written after the CSS (our own closing brace).
function assertNoTrailingEscape(css) {
  if (/(?:^|[^\\])(?:\\\\)*\\$/.test(css)) throw new Error("screen: unsafe CSS");
}

function assertNoAtRules(css) {
  for (let i = 0; i < css.length; i = step(css, i)) {
    if (css[i] === "@") throw REJECTED_AT_RULE((/^[-\w\\]*/.exec(css.slice(i + 1))[0] || "").toLowerCase());
  }
}

// Replaces every url(...) with a checked, canonical url("...") or `none`.
function rewriteUrls(text, ctx) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") { const e = skipString(text, i); out += text.slice(i, e); i = e; continue; }
    if (c === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
    if ((c === "u" || c === "U") && text.slice(i, i + 4).toLowerCase() === "url(") {
      const parsed = parseUrlFunction(text, i);
      if (parsed.ok) {
        const cls = classifyUrl(cssUnescape(parsed.raw));
        if (cls.ok && cls.kind === "fragment" && ID.test(cls.value.slice(1))) {
          out += `url(#${ctx.scope}-${cls.value.slice(1)})`;
        } else if (cls.ok && (cls.kind === "data" || (cls.kind === "local" && isImageFile(cls.value)))) {
          out += `url(${cssString(cls.kind === "local" ? ctx.image(cls.value) : cls.value)})`;
        } else {
          ctx.removed.push(`${cls.ok ? (cls.kind === "local" ? "non-image file" : "odd fragment") : cls.why ?? "unsafe"} url() in ${ctx.where}`);
          out += "none";
        }
      } else {
        ctx.removed.push(`malformed url() in ${ctx.where}`);
        out += "none";
      }
      i = parsed.end;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function parseUrlFunction(text, i) {
  let j = i + 4;
  while (j < text.length && /\s/.test(text[j])) j++;
  const bad = () => { const k = text.indexOf(")", i); return { ok: false, end: k < 0 ? text.length : k + 1 }; };
  if (text[j] === '"' || text[j] === "'") {
    const q = text[j];
    const e = skipString(text, j);
    if (e - 1 <= j || text[e - 1] !== q) return bad();
    const raw = text.slice(j + 1, e - 1);
    let k = e;
    while (k < text.length && /\s/.test(text[k])) k++;
    return text[k] === ")" ? { ok: true, raw, end: k + 1 } : bad();
  }
  let k = j;
  while (k < text.length && text[k] !== ")") { if (text[k] === "\\") k++; k++; }
  if (k >= text.length) return bad();
  const raw = text.slice(j, k).replace(/\s+$/, "");
  if (/[\s"'(]/.test(raw)) return bad();
  return { ok: true, raw, end: k + 1 };
}

const BANNED_PROPS = new Set(["behavior", "-ms-behavior", "-moz-binding", "-webkit-binding", "-o-link", "-o-link-source"]);
const BANNED_VALUE = /javascript:|vbscript:|livescript:|expression\(|progid:|image-set\(|(?:^|[^a-z0-9])src\(|image\(|cross-fade\(|element\(|paint\(|attr\(/;

function sanitizeDeclaration(text, ctx) {
  if (text.trim() === "") return text;
  const colon = text.indexOf(":");
  if (colon < 0) { ctx.removed.push(`stray text in ${ctx.where}`); return ""; }
  // Names and values are judged fully decoded: "-moz\2d binding" is -moz-binding, "image\2d set(" is image-set(.
  const prop = cssUnescape(text.slice(0, colon).trim()).toLowerCase();
  const value = text.slice(colon + 1);
  if (BANNED_PROPS.has(prop)) { ctx.removed.push(`${prop} property in ${ctx.where}`); return ""; }
  const banned = (v) => BANNED_VALUE.test(v.toLowerCase().replace(/\s+/g, ""));
  if (banned(value) || banned(cssUnescape(value))) { ctx.removed.push(`script or external-load value for ${prop} in ${ctx.where}`); return ""; }
  // Custom properties too: whatever var() can carry was checked where it was declared.
  const { found, escapedParen } = cssFunctions(value);
  if (escapedParen) { ctx.removed.push(`escaped bracket in the value of ${prop} in ${ctx.where}`); return ""; }
  const bad = found.find((f) => !allowedFunction(f.name));
  if (bad) { ctx.removed.push(`function ${bad.name.toLowerCase()}() in the value of ${prop} in ${ctx.where}`); return ""; }
  const flat = value.toLowerCase().replace(/\s+/g, " ").trim();
  const important = /!\s*important$/.test(flat);
  // Nothing in the screen may be positioned against the page: fixed and sticky (and anything computed) become absolute,
  // which the wrapper (position:relative; contain:paint) contains.
  if (prop === "position" && !/^(?:static|relative|absolute)$/.test(flat.replace(/!\s*important$/, "").trim())) {
    ctx.removed.push(`position:${flat} in ${ctx.where} (now absolute)`);
    return `${text.slice(0, colon)}:absolute${important ? "!important" : ""}`;
  }
  // display:contents would take the wrapper's box (and with it the clip) away.
  if (prop === "display" && /contents|var\(|env\(|attr\(/.test(flat)) { ctx.removed.push(`display:${flat} in ${ctx.where}`); return ""; }
  return `${text.slice(0, colon)}:${rewriteUrls(value, ctx)}`.replace(/\s+$/, "");
}

// Sanitises the inside of a { } block: declarations only. Nested rules (and with them "&") are refused, because a
// nested selector is not scoped and can reach anything (".t{ :not(&){...} }").
function sanitizeBlock(body, ctx) {
  for (let i = 0; i < body.length; i = step(body, i)) {
    if (body[i] === "{" || body[i] === "}") throw new Error("screen: nested CSS rules are not allowed");
  }
  let out = "";
  let i = 0;
  while (i < body.length) {
    let j = i;
    let depth = 0;
    while (j < body.length) {
      const c = body[j];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
      else if (depth === 0 && c === ";") break;
      j = step(body, j);
    }
    const decl = sanitizeDeclaration(body.slice(i, j), ctx);
    out += decl + (decl && j < body.length ? ";" : "");
    i = j + 1;
  }
  return out;
}

// Splits a stylesheet (comments already removed) into { prelude, body } rules.
function parseRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    let j = i;
    while (j < css.length && css[j] !== "{" && css[j] !== "}" && css[j] !== ";") j = step(css, j);
    if (css[j] !== "{") { i = j + 1; continue; } // junk up to a stray ; or }
    let k = j + 1;
    let depth = 1;
    while (k < css.length) {
      const c = css[k];
      if (c === "{") depth++;
      else if (c === "}") { depth--; if (depth === 0) break; }
      k = step(css, k);
    }
    rules.push({ prelude: css.slice(i, j).trim(), body: css.slice(j + 1, k) });
    i = k + 1;
  }
  return rules;
}

function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < prelude.length; i = step(prelude, i)) {
    const c = prelude[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) { parts.push(prelude.slice(from, i)); from = i + 1; }
  }
  parts.push(prelude.slice(from));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const ROOTISH = /^(?:html|body|:root)(?![A-Za-z0-9_\-\\\u0080-\uffff])/i;

// End of a CSS escape that starts at s[i] ("\"): up to six hex digits and one optional whitespace, or one character.
function escapeEnd(s, i) {
  const hex = /^[0-9a-fA-F]{1,6}/.exec(s.slice(i + 1, i + 7));
  if (!hex) return Math.min(s.length, i + 2);
  const j = i + 1 + hex[0].length;
  return j < s.length && /[ \t\n\f]/.test(s[j]) ? j + 1 : j;
}

// Same length as s, with strings and escapes blanked out, so structure can be read without being fooled by them.
function maskCss(s) {
  let out = "";
  for (let i = 0; i < s.length;) {
    const c = s[i];
    const e = c === '"' || c === "'" ? skipString(s, i) : c === "\\" ? escapeEnd(s, i) : i;
    if (e > i) { out += "_".repeat(e - i); i = e; } else { out += c; i++; }
  }
  return out;
}

// "#name" (outside strings and [attribute] tests) -> "#<scope>-name", to follow the prefixed ids in the markup.
function prefixIds(selector, scopeClass) {
  const m = maskCss(selector);
  let out = "";
  let brackets = 0;
  for (let i = 0; i < selector.length; i++) {
    if (m[i] === "[") brackets++;
    else if (m[i] === "]") brackets = Math.max(0, brackets - 1);
    out += selector[i];
    if (m[i] === "#" && brackets === 0 && /[A-Za-z0-9_\-\\\u0080-\uffff]/.test(selector[i + 1] ?? "")) out += `${scopeClass}-`;
  }
  return out;
}

const outside = (selector) => new Error(`screen: selector "${selector}" reaches outside the screen`);

// A scoped selector must start with the scope's own compound (".scope" then a space, ">", ".", ":", "[", "#" or the
// end) and its first combinator may only go down (descendant or child), never to a sibling ("~", "+") or a column.
function assertInside(scoped, dot, original) {
  const m = maskCss(scoped);
  if (!m.startsWith(dot) || !/^(?:$|[\s>.:[#])/.test(m.slice(dot.length))) throw outside(original);
  let i = dot.length;
  let depth = 0;
  for (; i < m.length; i++) {
    const c = m[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>~+|]/.test(c)) break;
  }
  while (i < m.length && /\s/.test(m[i])) i++;
  if (/[~+|]/.test(m[i] ?? "")) throw outside(original);
}

function scopeSelector(selector, scopeClass) {
  const dot = `.${scopeClass}`;
  // Nesting and shadow/scoping pseudo-classes resolve against things outside the screen.
  if (/&|:scope(?![A-Za-z0-9_-])|:host/i.test(maskCss(normaliseEscapes(selector)))) throw outside(selector);
  let rest = selector;
  let matched = false;
  for (;;) {
    const m = ROOTISH.exec(rest);
    if (!m) break;
    matched = true;
    rest = rest.slice(m[0].length);
    const chain = /^\s*(?:>\s*|\s)(?=(?:html|body|:root)(?![A-Za-z0-9_\-\\\u0080-\uffff]))/i.exec(rest);
    if (!chain) break;
    rest = rest.slice(chain[0].length);
  }
  // "" -> the screen itself; ".x"/":hover" -> same element; " p" / " > p" -> inside it
  const scoped = prefixIds(matched ? dot + rest : `${dot} ${selector}`, scopeClass);
  assertInside(scoped, dot, selector);
  return scoped;
}

export function scopeCss(css, scopeClass) {
  const rules = parseRules(stripComments(String(css).replace(/\r\n?/g, "\n")));
  const out = [];
  for (const { prelude, body } of rules) {
    if (prelude.startsWith("@")) throw REJECTED_AT_RULE((/^@([-\w\\]*)/.exec(prelude)[1] || "").toLowerCase());
    const selectors = splitSelectors(prelude).map((s) => scopeSelector(s, scopeClass));
    if (selectors.length) out.push(`${selectors.join(",")}{${body}}`);
  }
  return out.join(" ");
}

function sanitizeStylesheet(css, ctx) {
  const text = normaliseEscapes(stripComments(css.replace(/\r\n?/g, "\n").replace(/\0/g, "").replace(/<!--|-->/g, " ")));
  assertNoTrailingEscape(text);
  assertNoAtRules(text);
  return parseRules(text)
    .filter((r) => r.prelude)
    .map((r) => `${r.prelude}{${sanitizeBlock(r.body, ctx)}}`)
    .join(" ");
}

// Last line of defence: scans what is about to be emitted, treating everything outside quoted strings as live. Fails
// closed: every string must be terminated and every (), [] and {} balanced, so the CSS cannot run on into whatever
// follows it, and nothing that loads or runs may appear.
function assertSafeCss(css) {
  const unsafe = () => new Error("screen: unsafe CSS");
  const PAIR = { ")": "(", "]": "[", "}": "{" };
  const open = [];
  let live = "";
  for (let i = 0; i < css.length;) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c && css[j] !== "\n" && css[j] !== "\f" && css[j] !== "\r") j += css[j] === "\\" ? 2 : 1;
      if (j >= css.length || css[j] !== c) throw unsafe();
      live += '""';
      i = j + 1;
    } else if (c === "\\") {
      if (i + 1 >= css.length || /[\n\f\r]/.test(css[i + 1])) throw unsafe();
      const e = escapeEnd(css, i);
      live += " ".repeat(e - i);
      i = e;
    } else {
      if (c === "(" || c === "[" || c === "{") open.push(c);
      else if (c in PAIR && open.pop() !== PAIR[c]) throw unsafe();
      live += c;
      i++;
    }
  }
  if (open.length) throw unsafe();
  // Every function, decoded: allowlisted value functions anywhere, functional pseudo-classes only right after ":".
  // (An escaped bracket is only refused in values, where sanitizeDeclaration drops it: selectors such as Tailwind's
  // ".w-\[calc\(100\%\)\]" need them, and there they are plain name characters.)
  const { found } = cssFunctions(css);
  for (const f of found) {
    if (!allowedFunction(f.name) && !(f.before === ":" && PSEUDO_FUNCTIONS.has(f.name.toLowerCase()))) throw unsafe();
  }
  const low = live.toLowerCase();
  if (low.includes("@") || /expression\s*\(|javascript:|vbscript:|livescript:|-moz-binding|behavior\s*:|image-set\s*\(|(?:^|[^a-z0-9])src\s*\(|progid|url\s*\((?!\s*""\s*\)|#[a-z0-9_-]+\))/.test(low)) {
    throw unsafe();
  }
}

const escapeLt = (css) => css.replace(/</g, "\\3c ");

// ------------------------------------------------------------------ HTML

const COMMENT_END = /--!?>/g;

function isWs(c) { return c === " " || c === "\t" || c === "\n" || c === "\f" || c === "\r"; }

// Parses a tag whose "<" is at i. Returns { name, attrs, selfClosing, end } or { end: -1 }
// when the input ends inside the tag.
function parseTag(src, i, isEnd) {
  const n = src.length;
  let j = i + (isEnd ? 2 : 1);
  const s = j;
  while (j < n && !isWs(src[j]) && src[j] !== "/" && src[j] !== ">") j++;
  const name = src.slice(s, j);
  const attrs = [];
  for (;;) {
    let slash = false;
    while (j < n && (isWs(src[j]) || src[j] === "/")) { slash = src[j] === "/"; j++; }
    if (j >= n) return { end: -1 };
    if (src[j] === ">") return { name, attrs, selfClosing: slash, end: j + 1 };
    const ns = j;
    j++; // the first character is always part of the name, even "="
    while (j < n && !isWs(src[j]) && src[j] !== "/" && src[j] !== ">" && src[j] !== "=") j++;
    const aname = src.slice(ns, j);
    while (j < n && isWs(src[j])) j++;
    let value = "";
    if (src[j] === "=") {
      j++;
      while (j < n && isWs(src[j])) j++;
      if (src[j] === '"' || src[j] === "'") {
        const close = src.indexOf(src[j], j + 1);
        if (close < 0) return { end: -1 };
        value = src.slice(j + 1, close);
        j = close + 1;
      } else if (src[j] !== ">") {
        const vs = j;
        while (j < n && !isWs(src[j]) && src[j] !== ">") j++;
        value = src.slice(vs, j);
      }
    }
    attrs.push({ name: aname, value });
  }
}

function skipRaw(src, from, name) {
  const re = new RegExp(`</${name}(?=[\\s/>])`, "gi");
  re.lastIndex = from;
  const m = re.exec(src);
  if (!m) return { content: src.slice(from), end: src.length };
  const gt = src.indexOf(">", m.index);
  return { content: src.slice(from, m.index), end: gt < 0 ? src.length : gt + 1 };
}

function skipElement(src, from, name) {
  const re = new RegExp(`<(/?)${name}(?=[\\s/>])`, "gi");
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(src))) {
    if (m[1]) {
      depth--;
      if (depth === 0) { const gt = src.indexOf(">", m.index); return gt < 0 ? src.length : gt + 1; }
    } else depth++;
  }
  return src.length;
}

function cleanStyle(tag, value, ctx) {
  const text = normaliseEscapes(stripComments(value.replace(/\r\n?/g, "\n").replace(/\0/g, "")));
  assertNoTrailingEscape(text);
  assertNoAtRules(text);
  const cleaned = escapeLt(sanitizeBlock(text, { ...ctx, where: `style attribute on <${tag}>` }));
  assertSafeCss(cleaned);
  return cleaned;
}

// Keeps only allowlisted attributes, each with a checked value. Ids are prefixed with the scope (and so is every
// same-document reference to them), so the screen can neither wear nor point at the scene's own ids.
function cleanAttributes(tag, ns, attrs, ctx) {
  const out = [];
  const seen = new Set();
  let hasImageSource = false;
  const drop = (msg) => ctx.removed.push(`${msg} on <${tag}>`);
  const local = (id) => `${ctx.scope}-${id}`;
  for (const { name, value: rawValue } of attrs) {
    const lname = name.toLowerCase();
    if (seen.has(lname)) continue; // the browser keeps the first one
    seen.add(lname);
    const value = decodeEntities(rawValue);

    if (lname === "id") {
      if (ID.test(value)) out.push(["id", local(value)]); else drop("id that is not a plain name");
      continue;
    }
    if (lname === "class") {
      const all = value.split(/[ \t\n\f\r]+/).filter(Boolean);
      const reserved = (c) => RESERVED_CLASS.has(c.toLowerCase()) || RESERVED_CLASS_PREFIX.test(c.toLowerCase());
      const keep = all.filter((c) => !reserved(c));
      if (keep.length < all.length) drop(`template class names (${all.filter(reserved).join(" ")})`);
      if (keep.length) out.push(["class", keep.join(" ")]);
      continue;
    }
    if (lname === "style") {
      try { out.push(["style", cleanStyle(tag, value, ctx)]); } catch (e) {
        if (e.fatal || !/^screen: /.test(e.message)) throw e;
        drop("unsafe style attribute");
      }
      continue;
    }
    if (ARIA_IDREFS.has(lname)) {
      const ids = value.split(/[ \t\n\f\r]+/).filter((v) => ID.test(v));
      if (ids.length) out.push([lname, ids.map(local).join(" ")]); else drop(`${lname} without plain ids`);
      continue;
    }
    if (lname === "width" || lname === "height" || lname === "colspan" || lname === "rowspan") {
      if (SVG_VALUE.test(value) && !/url\s*\(/i.test(value)) out.push([lname, value]); else drop(`odd ${lname} value`);
      continue;
    }
    if (GENERAL_ATTRS.has(lname) || DATA_ATTRS.has(lname) || /^aria-[a-z]+$/.test(lname)) {
      out.push([lname, value]);
      continue;
    }
    if (lname === "href" && tag === "a") {
      const c = classifyUrl(value);
      // Only links within the screen: a relative link names a project file (compositions/..., assets/...).
      if (c.ok && c.kind === "fragment" && (c.value === "#" || ID.test(c.value.slice(1)))) out.push(["href", c.value === "#" ? "#" : `#${local(c.value.slice(1))}`]);
      else drop(`${c.ok ? "link that is not a #fragment" : c.why} in href`);
      continue;
    }
    if ((lname === "href" || lname === "xlink:href") && tag === "use") {
      const c = classifyUrl(value);
      if (c.ok && c.kind === "fragment" && ID.test(c.value.slice(1))) out.push([lname, `#${local(c.value.slice(1))}`]);
      else drop(`${lname} that is not a same-document fragment`);
      continue;
    }
    if (lname === "src" && tag === "img") {
      const c = classifyUrl(value);
      if (c.ok && (c.kind === "data" || (c.kind === "local" && isImageFile(c.value)))) {
        out.push(["src", c.kind === "local" ? ctx.image(c.value) : c.value]);
        hasImageSource = true;
      } else drop(`${c.ok ? "not an image file" : c.why} in src`);
      continue;
    }
    if (ns === "svg" && SVG_ATTRS.has(lname)) {
      const canonical = SVG_ATTRS.get(lname);
      if (!SVG_VALUE.test(value)) { drop(`odd ${canonical} value`); continue; }
      if (/url\s*\(/i.test(value)) {
        // Only paint and clip/mask references to an element of this screen.
        if (!URL_ATTRS.has(lname) || /url\s*\(/i.test(value.replace(FRAGMENT_URL, ""))) { drop(`url() in ${canonical}`); continue; }
        out.push([canonical, value.replace(FRAGMENT_URL, (m, id) => `url(#${local(id)})`)]);
        continue;
      }
      out.push([canonical, value]);
      continue;
    }
    drop(`${lname} attribute`);
  }
  return { attrs: out, hasImageSource };
}

// `mapImage(path, k)` (optional) names what the k-th distinct local image (from 0) is written as in the output, so a
// caller that copies the images can point at the copies without searching the output again. It may throw to refuse.
export function sanitizeScreen(html, scopeClass, { mapImage } = {}) {
  if (typeof html !== "string") throw new TypeError("screen: html must be a string");
  if (typeof scopeClass !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(scopeClass)) throw new Error("screen: invalid scope class");
  if (html.length > MAX_BYTES || Buffer.byteLength(html, "utf8") > MAX_BYTES) throw new Error("screen: the screen HTML is over 256 KB");

  const removed = [];
  const images = new Map(); // local path as written -> as emitted
  const image = (path) => {
    if (!images.has(path)) {
      const k = images.size;
      let emitted = path;
      if (mapImage) {
        try { emitted = String(mapImage(path, k)); } catch (e) { throw Object.assign(e, { fatal: true }); }
      }
      if (k >= MAX_IMAGES) throw fatal(`screen: the screen uses more than ${MAX_IMAGES} images`);
      images.set(path, emitted);
    }
    return images.get(path);
  };
  const styles = [];
  const ctx = { removed, image, where: "style", scope: scopeClass };
  const src = html.replace(/\0/g, "").replace(/\r\n?/g, "\n");
  const n = src.length;

  // The output is rebuilt with an open-element stack that mirrors what the browser will build: an end tag is only
  // emitted for an element that is open (after closing the ones inside it), the closes the browser would imply are
  // written out explicitly first, and everything still open is closed at the end. So the markup can neither close the
  // wrapper it is put in nor swallow the scene markup after it.
  let out = [];
  let stack = []; // { name: as emitted, lname, ns: "html" | "svg" }
  let bodySeen = false;
  // A start tag past MAX_DEPTH is dropped and counted, by name, on the deepest open element; a matching end tag inside
  // that element is then dropped too, so it cannot close an outer element. The counts go when that element closes.
  const overflow = (name) => {
    const t = top();
    t.over ??= new Map();
    t.over.set(name, (t.over.get(name) ?? 0) + 1);
    removed.push(`<${name}> nested more than ${MAX_DEPTH} deep`);
  };
  const top = () => stack[stack.length - 1];
  const closeTo = (k) => { while (stack.length > k) out.push(`</${stack.pop().name}>`); };
  const push = (name, lname, ns) => stack.push({ name, lname, ns });
  const text = (t) => {
    if (!t) return;
    const cur = top();
    if (cur && TABLE_CONTEXT.has(cur.lname) && !/^[ \t\n\f\r]*$/.test(t)) { removed.push("text directly inside a table"); return; }
    out.push(escText(t));
  };
  const pInButtonScope = () => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (stack[k].lname === "p") return k;
      if (BUTTON_SCOPE.has(stack[k].lname) || stack[k].ns !== "html") return -1;
    }
    return -1;
  };

  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { text(src.slice(i)); break; }
    if (lt > i) text(src.slice(i, lt));
    i = lt;
    const next = src[i + 1] ?? "";

    if (src.startsWith("<!--", i)) {
      let end;
      if (src[i + 4] === ">") end = i + 5;
      else if (src.startsWith("->", i + 4)) end = i + 6;
      else { COMMENT_END.lastIndex = i + 4; const m = COMMENT_END.exec(src); end = m ? m.index + m[0].length : n; }
      removed.push("HTML comment");
      i = end;
      continue;
    }
    if (next === "!" || next === "?") {
      const gt = src.indexOf(">", i);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    const isEnd = next === "/";
    if (!(isEnd ? /[A-Za-z]/.test(src[i + 2] ?? "") : /[A-Za-z]/.test(next))) {
      if (isEnd) { const gt = src.indexOf(">", i); i = gt < 0 ? n : gt + 1; } // bogus comment
      else { text("<"); i++; }
      continue;
    }

    const tok = parseTag(src, i, isEnd);
    if (tok.end < 0) { removed.push("unfinished tag at the end"); break; }
    i = tok.end;
    const name = tok.name;
    if (!/^[A-Za-z][A-Za-z0-9:-]*$/.test(name)) { removed.push("tag with an invalid name"); continue; }
    const lname = name.toLowerCase();
    const cur = top();
    const inSvg = cur?.ns === "svg";

    if (isEnd) {
      if (lname === "body" && bodySeen) break; // nothing after </body> is used
      const over = top()?.over?.get(lname);
      if (over) { top().over.set(lname, over - 1); continue; }
      let k = stack.length - 1;
      while (k >= 0 && stack[k].lname !== lname) k--;
      if (k >= 0) closeTo(k);
      else if (!DOCUMENT.has(lname)) removed.push(`</${lname}> without an open element`);
      continue;
    }

    if (lname === "style") {
      const raw = skipRaw(src, i, "style");
      styles.push(raw.content);
      i = raw.end;
      continue;
    }
    // Inside <svg>, <title> is an element (but inside an svg <title> the browser reads tags as HTML again).
    if (RAW_TEXT.has(lname) && !(lname === "title" && inSvg && cur.lname !== "title")) {
      removed.push(`<${lname}> element`);
      i = lname === "plaintext" ? n : skipRaw(src, i, lname).end;
      continue;
    }
    if (DROP_WITH_CONTENT.has(lname)) {
      removed.push(`<${lname}> element`);
      if (!(inSvg && tok.selfClosing)) i = skipElement(src, i, name);
      continue;
    }
    if (DOCUMENT.has(lname)) {
      if (tok.attrs.length) removed.push(`attributes on <${lname}>`);
      if (lname === "body" && !bodySeen) { bodySeen = true; out = []; stack = []; } // keep only what is inside <body>
      continue;
    }

    // Element allowlist, by context.
    let tag;
    let ns;
    if (inSvg) {
      // Only SVG shapes inside <svg> (an HTML tag there would break out of it), and only text inside an svg <title>.
      if (cur.lname === "title" || !SVG_ELEMENTS.has(lname)) { removed.push(`<${lname}> tag inside <svg>`); continue; }
      tag = SVG_ELEMENTS.get(lname);
      ns = "svg";
    } else if (lname === "svg") { tag = "svg"; ns = "svg"; }
    else if (HTML_ELEMENTS.has(lname)) { tag = lname; ns = "html"; }
    else { removed.push(`<${lname}> tag`); continue; }

    if (!inSvg) {
      // Table parts only in their own parent, and nothing else directly in a table: no foster parenting.
      const parent = cur?.lname;
      let impliedBody = false;
      if (SECTIONS.has(tag) ? parent !== "table"
        : tag === "tr" ? !(SECTIONS.has(parent) || (impliedBody = parent === "table"))
        : tag === "td" || tag === "th" ? parent !== "tr"
        : TABLE_CONTEXT.has(parent)) {
        removed.push(`<${tag}> in the wrong place in a table`);
        continue;
      }
      // Nested links and buttons are re-parented by the browser; keep only the outer one.
      if ((tag === "a" || tag === "button") && stack.some((e) => e.lname === tag)) { removed.push(`nested <${tag}>`); continue; }
      if (impliedBody && stack.length + 2 > MAX_DEPTH) { overflow(lname); continue; }
      if (impliedBody) { out.push("<tbody>"); push("tbody", "tbody", "html"); }
      // Write out the closes the browser would imply.
      if (tag === "li") {
        for (let k = stack.length - 1; k >= 0; k--) {
          const e = stack[k].lname;
          if (e === "li") { closeTo(k); break; }
          if (SPECIAL.has(e) && e !== "div" && e !== "p") break;
        }
      }
      if (CLOSES_P.has(tag)) { const k = pInButtonScope(); if (k >= 0) closeTo(k); }
      if (HEADINGS.has(tag) && HEADINGS.has(top()?.lname)) closeTo(stack.length - 1);
    }

    const { attrs, hasImageSource } = cleanAttributes(tag, ns, tok.attrs, ctx);
    if (tag === "img" && !hasImageSource) { removed.push("<img> without a local or inline image"); continue; }
    // In SVG "/>" closes the element (an unclosed <circle> would swallow its siblings); on an HTML element the browser
    // ignores it, so it is only kept on void elements.
    const selfClosed = VOID.has(tag) || (ns === "svg" && tok.selfClosing);
    if (!selfClosed && stack.length >= MAX_DEPTH) { overflow(lname); continue; }
    out.push(`<${tag}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}${tok.selfClosing && selfClosed ? "/" : ""}>`);
    if (!selfClosed) push(tag, lname, ns);
  }
  closeTo(0);

  let css = "";
  if (styles.some((s) => s.trim())) {
    const cleaned = sanitizeStylesheet(styles.join("\n"), { ...ctx, where: "<style>" });
    css = escapeLt(scopeCss(cleaned, scopeClass));
    assertSafeCss(css);
  }

  return { html: out.join("").trim(), css, images: [...images.keys()], removed };
}
