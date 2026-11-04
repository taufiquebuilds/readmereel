// Cleans and scopes an agent-rebuilt HTML screen before it goes into a film.
//
// Approach: the HTML is tokenised by a small parser that follows the HTML
// tokenizer rules for tag names, attributes, comments and raw-text elements,
// and the markup is then REBUILT from the parsed pieces (known tag name,
// decoded + re-escaped attribute values). Nothing the agent typed is copied
// through verbatim, so what the browser later parses is exactly what was
// checked here. CSS gets the same treatment: comments stripped, escapes
// normalised, every url() re-written to a checked canonical form, and a final
// conservative scan that fails closed.
//
// No dependencies. This is a defence for generated demo screens that are
// rendered to video, not a general-purpose sanitiser for untrusted web pages.

const REJECTED_AT_RULE = (name) => new Error(`screen: @${name} is not allowed`);

// ---------------------------------------------------------------- HTML tables

// Elements whose content is raw text for the browser. They are always dropped
// (or, for <style>, extracted), so raw-text parsing can never be re-created
// from the output.
const RAW_TEXT = new Set(["script", "style", "iframe", "noembed", "noframes", "noscript", "xmp", "textarea", "title", "plaintext"]);
// Elements removed together with everything inside them.
const DROP_WITH_CONTENT = new Set(["object", "form", "template", "applet", "frameset", "portal", "video", "audio", "math"]);
// Elements removed on their own (void or without useful content).
const DROP_TAG_ONLY = new Set([
  "link", "meta", "base", "input", "embed", "param", "source", "track", "frame", "isindex",
  "animate", "animatetransform", "animatemotion", "set", "discard", "handler", "listener",
]);
const SILENT_STRUCTURE = new Set(["html", "head"]);

const BANNED_ATTRS = new Set([
  "srcdoc", "formaction", "srcset", "imagesrcset", "action", "data", "poster", "background", "ping", "cite",
  "longdesc", "manifest", "codebase", "lowsrc", "dynsrc", "profile", "archive", "classid", "code", "usemap",
  "xml:base", "is", "http-equiv",
]);

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

// A local value that will be copied as a file must be a plain path.
const isFilePath = (v) => !/[?#]/.test(v);

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

export const cssString = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "").replace(/</g, "\\3c ")}"`;

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
        if (cls.ok && (cls.kind !== "local" || isFilePath(cls.value))) {
          if (cls.kind === "local") ctx.images.push(cls.value);
          out += cls.kind === "fragment" && /^#[A-Za-z0-9_-]+$/.test(cls.value) ? `url(${cls.value})` : `url(${cssString(cls.value)})`;
        } else {
          ctx.removed.push(`${cls.why ?? "unsafe"} url() in ${ctx.where}`);
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
  const prop = text.slice(0, colon).trim().toLowerCase();
  const value = text.slice(colon + 1);
  if (BANNED_PROPS.has(prop)) { ctx.removed.push(`${prop} property in ${ctx.where}`); return ""; }
  if (BANNED_VALUE.test(value.toLowerCase().replace(/\s+/g, ""))) { ctx.removed.push(`script or external-load value for ${prop} in ${ctx.where}`); return ""; }
  return `${text.slice(0, colon)}:${rewriteUrls(value, ctx)}`.replace(/\s+$/, "");
}

// Sanitises the inside of a { } block (declarations and nested rules).
function sanitizeBlock(body, ctx) {
  let out = "";
  let i = 0;
  while (i < body.length) {
    let j = i;
    let depth = 0;
    let kind = "decl";
    while (j < body.length) {
      const c = body[j];
      if (c === "(" || c === "[") depth++;
      else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
      else if (depth === 0 && c === ";") break;
      else if (depth === 0 && c === "{") { kind = "rule"; break; }
      j = step(body, j);
    }
    if (kind === "rule") {
      let k = j + 1;
      let braces = 1;
      while (k < body.length) {
        const c = body[k];
        if (c === "{") braces++;
        else if (c === "}") { braces--; if (braces === 0) break; }
        k = step(body, k);
      }
      out += `${body.slice(i, j)}{${sanitizeBlock(body.slice(j + 1, k), ctx)}}`;
      i = k + 1;
    } else {
      const decl = sanitizeDeclaration(body.slice(i, j), ctx);
      out += decl + (decl && j < body.length ? ";" : "");
      i = j + 1;
    }
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

function scopeSelector(selector, scopeClass) {
  const dot = `.${scopeClass}`;
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
  if (!matched) return `${dot} ${selector}`;
  return dot + rest; // "" -> the screen itself; ".x"/":hover" -> same element; " p" / " > p" -> inside it
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
  assertNoAtRules(text);
  return parseRules(text)
    .filter((r) => r.prelude)
    .map((r) => `${r.prelude}{${sanitizeBlock(r.body, ctx)}}`)
    .join(" ");
}

// Last line of defence: scans what is about to be emitted, treating everything
// outside quoted strings as live. Fails closed.
function assertSafeCss(css) {
  let outside = "";
  for (let i = 0; i < css.length;) {
    if (css[i] === '"' || css[i] === "'") { const e = skipString(css, i); outside += '""'; i = e; }
    else if (css[i] === "\\") { outside += "  "; i += 2; }
    else { outside += css[i]; i++; }
  }
  const low = outside.toLowerCase();
  if (low.includes("@") || /expression\s*\(|javascript:|vbscript:|livescript:|-moz-binding|behavior\s*:|image-set\s*\(|(?:^|[^a-z0-9])src\s*\(|progid|url\s*\((?!\s*""|#[a-z0-9_-]+\))/.test(low)) {
    throw new Error("screen: unsafe CSS");
  }
}

const escapeLt = (css) => css.replace(/</g, "\\3c ");

// ------------------------------------------------------------------ HTML

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

function cleanAttributes(tag, attrs, ctx) {
  const out = [];
  const seen = new Set();
  let hasImageSource = false;
  const drop = (msg) => ctx.removed.push(msg);
  for (const { name, value: rawValue } of attrs) {
    const lname = name.toLowerCase();
    if (seen.has(lname)) continue; // the browser keeps the first one
    seen.add(lname);
    if (!/^[A-Za-z_:][A-Za-z0-9_:.\-]*$/.test(name)) { drop(`attribute with an invalid name on <${tag}>`); continue; }
    if (lname.startsWith("on")) { drop(`${lname} event handler on <${tag}>`); continue; }
    if (BANNED_ATTRS.has(lname)) { drop(`${lname} attribute on <${tag}>`); continue; }
    const value = decodeEntities(rawValue);

    if (lname === "href" || lname === "xlink:href") {
      const c = classifyUrl(value);
      let ok = false;
      if (c.ok && c.kind === "fragment") ok = true;
      else if (c.ok && (tag === "a" || tag === "area")) ok = true;
      else if (c.ok && tag === "image" && (c.kind === "data" || (c.kind === "local" && isFilePath(c.value)))) {
        ok = true;
        hasImageSource = true;
        if (c.kind === "local") ctx.images.push(c.value);
      }
      if (ok) out.push([name, c.value]); else drop(`${c.why ?? "unsupported"} in ${lname} on <${tag}>`);
      continue;
    }
    if (lname === "src") {
      const c = classifyUrl(value);
      if ((tag === "img" || tag === "image") && c.ok && (c.kind === "data" || (c.kind === "local" && isFilePath(c.value)))) {
        out.push([name, c.value]);
        hasImageSource = true;
        if (c.kind === "local") ctx.images.push(c.value);
      } else drop(`${c.why ?? "unsupported"} in src on <${tag}>`);
      continue;
    }
    if (lname === "style") {
      try {
        const sub = { ...ctx, where: `style attribute on <${tag}>` };
        const text = normaliseEscapes(stripComments(value.replace(/\r\n?/g, "\n").replace(/\0/g, "")));
        assertNoAtRules(text);
        const cleaned = escapeLt(sanitizeBlock(text, sub));
        assertSafeCss(cleaned);
        out.push([name, cleaned]);
      } catch {
        drop(`unsafe style attribute on <${tag}>`);
      }
      continue;
    }
    // Other attributes (SVG fill="url(...)", filter, mask, ...) can carry url().
    const probe = normaliseEscapes(stripComments(value));
    if (/url\s*\(|image-set\s*\(|expression\s*\(/i.test(probe)) {
      if (BANNED_VALUE.test(probe.toLowerCase().replace(/\s+/g, ""))) { drop(`${lname} attribute on <${tag}>`); continue; }
      out.push([name, rewriteUrls(probe, { ...ctx, where: `${lname} attribute on <${tag}>` })]);
      continue;
    }
    out.push([name, value]);
  }
  return { attrs: out, hasImageSource };
}

export function sanitizeScreen(html, scopeClass) {
  if (typeof html !== "string") throw new TypeError("screen: html must be a string");
  if (typeof scopeClass !== "string" || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(scopeClass)) throw new Error("screen: invalid scope class");

  const removed = [];
  const images = [];
  const styles = [];
  const ctx = { removed, images, where: "style" };
  const src = html.replace(/\0/g, "").replace(/\r\n?/g, "\n");
  const n = src.length;

  let out = [];
  let bodySeen = false;
  let bodyDone = false;
  const emit = (s) => { if (!bodyDone) out.push(s); };

  let i = 0;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { emit(escText(src.slice(i))); break; }
    if (lt > i) emit(escText(src.slice(i, lt)));
    i = lt;
    const next = src[i + 1] ?? "";

    if (src.startsWith("<!--", i)) {
      let end;
      if (src[i + 4] === ">") end = i + 5;
      else if (src.startsWith("->", i + 4)) end = i + 6;
      else { const m = /--!?>/.exec(src.slice(i + 4)); end = m ? i + 4 + m.index + m[0].length : n; }
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
      else { emit("&lt;"); i++; }
      continue;
    }

    const tok = parseTag(src, i, isEnd);
    if (tok.end < 0) { removed.push("unfinished tag at the end"); break; }
    i = tok.end;
    const name = tok.name;
    if (!/^[A-Za-z][A-Za-z0-9:-]*$/.test(name)) { removed.push("tag with an invalid name"); continue; }
    const lname = name.toLowerCase();
    const base = lname.includes(":") ? lname.slice(lname.lastIndexOf(":") + 1) : lname;

    if (isEnd) {
      if (base === "body") { if (bodySeen) bodyDone = true; continue; }
      if (RAW_TEXT.has(base) || DROP_WITH_CONTENT.has(base) || DROP_TAG_ONLY.has(base) || SILENT_STRUCTURE.has(base)) continue;
      emit(`</${name}>`);
      continue;
    }

    if (base === "style") {
      const raw = skipRaw(src, i, name.toLowerCase());
      styles.push(raw.content);
      i = raw.end;
      continue;
    }
    if (RAW_TEXT.has(base)) {
      removed.push(`<${base}> element`);
      i = base === "plaintext" ? n : skipRaw(src, i, name).end;
      continue;
    }
    if (DROP_WITH_CONTENT.has(base)) {
      removed.push(`<${base}> element`);
      i = skipElement(src, i, name);
      continue;
    }
    if (DROP_TAG_ONLY.has(base)) {
      removed.push(`<${base}> tag`);
      continue;
    }
    if (SILENT_STRUCTURE.has(base) || base === "body") {
      cleanAttributes(base, tok.attrs, { ...ctx, removed }); // records onload etc.
      if (base === "body" && !bodySeen) { bodySeen = true; out = []; } // keep only what is inside <body>
      continue;
    }

    const { attrs, hasImageSource } = cleanAttributes(lname, tok.attrs, ctx);
    if ((base === "img" || base === "image") && !hasImageSource) {
      removed.push(`<${base}> without a local or inline image`);
      continue;
    }
    // Keep "/>": inside <svg> an unclosed <circle> would swallow its siblings.
    emit(`<${name}${attrs.map(([k, v]) => ` ${k}="${escAttr(v)}"`).join("")}${tok.selfClosing ? "/" : ""}>`);
  }

  let css = "";
  if (styles.some((s) => s.trim())) {
    const cleaned = sanitizeStylesheet(styles.join("\n"), { ...ctx, where: "<style>" });
    css = escapeLt(scopeCss(cleaned, scopeClass));
    assertSafeCss(css);
  }

  return { html: out.join("").trim(), css, images: [...new Set(images)], removed };
}
