// A small HTML tree and CSS selector matcher, enough to find in a built project the element a HyperFrames check
// finding names. It reads only what readmereel writes (its templates and sanitized screens, both well formed), so it
// keeps the tree as written: no implied end tags and no foster parenting. A selector it cannot read throws, so the
// caller can fail closed. No dependencies.

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes", "noscript"]);
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };

const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, e) => {
  if (e[0] === "#") {
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  }
  return ENTITIES[e.toLowerCase()] ?? whole;
});

function element(tag, attrs, parent) {
  return { tag, attrs, children: [], parent };
}

const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";

// Parses a start tag at src[i] === "<". Returns { tag, attrs, selfClosing, end } or null when it is not a tag.
function startTag(src, i) {
  let j = i + 1;
  if (!/[A-Za-z]/.test(src[j] ?? "")) return null;
  while (j < src.length && !isSpace(src[j]) && src[j] !== "/" && src[j] !== ">") j++;
  const tag = src.slice(i + 1, j).toLowerCase();
  const attrs = {};
  let selfClosing = false;
  while (j < src.length) {
    while (j < src.length && isSpace(src[j])) j++;
    if (src[j] === ">") return { tag, attrs, selfClosing, end: j + 1 };
    if (src[j] === "/") {
      selfClosing = src[j + 1] === ">";
      j++;
      continue;
    }
    const nameStart = j;
    while (j < src.length && !isSpace(src[j]) && !"/>=".includes(src[j])) j++;
    const name = src.slice(nameStart, j).toLowerCase();
    if (!name) { j++; continue; }
    while (j < src.length && isSpace(src[j])) j++;
    let value = "";
    if (src[j] === "=") {
      j++;
      while (j < src.length && isSpace(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, j + 1);
        const stop = close < 0 ? src.length : close;
        value = src.slice(j + 1, stop);
        j = stop + 1;
      } else {
        const valueStart = j;
        while (j < src.length && !isSpace(src[j]) && src[j] !== ">") j++;
        value = src.slice(valueStart, j);
      }
    }
    if (!(name in attrs)) attrs[name] = decode(value);
  }
  return { tag, attrs, selfClosing, end: src.length };
}

export function parseHtml(src) {
  const doc = element("#document", {}, null);
  const stack = [doc];
  const top = () => stack[stack.length - 1];
  const text = (s) => { if (s) top().children.push({ text: decode(s), parent: top() }); };
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { text(src.slice(i)); break; }
    text(src.slice(i, lt));
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      i = e < 0 ? src.length : e + 3;
      continue;
    }
    if (src[lt + 1] === "!" || src[lt + 1] === "?") {
      const e = src.indexOf(">", lt);
      i = e < 0 ? src.length : e + 1;
      continue;
    }
    if (src[lt + 1] === "/") {
      const m = /^<\/([A-Za-z][^\s/>]*)[^>]*>/.exec(src.slice(lt, lt + 256));
      if (!m) { text("<"); i = lt + 1; continue; }
      const tag = m[1].toLowerCase();
      const at = stack.findLastIndex((el) => el.tag === tag);
      if (at > 0) stack.length = at;
      i = lt + m[0].length;
      continue;
    }
    const t = startTag(src, lt);
    if (!t) { text("<"); i = lt + 1; continue; }
    const el = element(t.tag, t.attrs, top());
    top().children.push(el);
    i = t.end;
    if (RAW.has(t.tag)) {
      const close = src.toLowerCase().indexOf(`</${t.tag}`, i);
      const stop = close < 0 ? src.length : close;
      if (stop > i) el.children.push({ text: src.slice(i, stop), parent: el });
      const gt = close < 0 ? -1 : src.indexOf(">", close);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    if (!VOID.has(t.tag) && !t.selfClosing) stack.push(el);
  }
  return doc;
}

export const isElement = (node) => node && typeof node.tag === "string" && node.tag !== "#document";
export const childElements = (el) => el.children.filter(isElement);
export const classesOf = (el) => String(el.attrs?.class ?? "").split(/\s+/).filter(Boolean);

export function* walk(node) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue;
    yield child;
    yield* walk(child);
  }
}

export function textContent(node) {
  if (!node.children) return node.text ?? "";
  return node.children.map(textContent).join("");
}

export function closest(el, test) {
  for (let cur = el; isElement(cur); cur = cur.parent) if (test(cur)) return cur;
  return null;
}

export const contains = (ancestor, el) => closest(el, (x) => x === ancestor) !== null;

// ---------- selectors ----------

const unsupported = (selector, why) => new Error(`unsupported selector "${selector}": ${why}`);

// An+B for :nth-*: "odd", "even", "3", "2n+1", "-n+3".
function parseNth(arg, selector) {
  const s = arg.replace(/\s+/g, "").toLowerCase();
  if (s === "odd") return [2, 1];
  if (s === "even") return [2, 0];
  if (/^[+-]?\d+$/.test(s)) return [0, Number(s)];
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(s);
  if (!m) throw unsupported(selector, `bad :nth argument "${arg}"`);
  const a = m[1] === "" || m[1] === "+" ? 1 : m[1] === "-" ? -1 : Number(m[1]);
  return [a, m[2] ? Number(m[2]) : 0];
}
const nthOk = ([a, b], pos) => (a === 0 ? pos === b : (pos - b) / a >= 0 && Number.isInteger((pos - b) / a));

const IDENT = /^-?[A-Za-z_\u00a0-\uffff][\w\u00a0-\uffff-]*/;

// One compound selector from `s` at `i`: { tag, ids, classes, attrs, pseudos, end }.
function parseCompound(s, i, selector) {
  const c = { tag: null, ids: [], classes: [], attrs: [], pseudos: [] };
  const ident = () => {
    const m = IDENT.exec(s.slice(i));
    if (!m) throw unsupported(selector, `expected a name at ${i}`);
    i += m[0].length;
    return m[0];
  };
  if (s[i] === "*") { i++; c.tag = "*"; } else if (IDENT.test(s.slice(i))) c.tag = ident().toLowerCase();
  for (;;) {
    const ch = s[i];
    if (ch === "#") { i++; c.ids.push(ident()); } else if (ch === ".") { i++; c.classes.push(ident()); } else if (ch === "[") {
      const close = s.indexOf("]", i);
      if (close < 0) throw unsupported(selector, "unclosed [");
      const m = /^\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?$/.exec(s.slice(i + 1, close));
      if (!m) throw unsupported(selector, `attribute test "${s.slice(i, close + 1)}"`);
      c.attrs.push({ name: m[1].toLowerCase(), op: m[2] ?? null, value: m[3] ?? m[4] ?? m[5] ?? "" });
      i = close + 1;
    } else if (ch === ":") {
      if (s[i + 1] === ":") throw unsupported(selector, "pseudo-element");
      i++;
      const name = ident().toLowerCase();
      let arg = null;
      if (s[i] === "(") {
        const close = s.indexOf(")", i);
        if (close < 0) throw unsupported(selector, "unclosed (");
        arg = s.slice(i + 1, close);
        i = close + 1;
      }
      if (["nth-of-type", "nth-child", "nth-last-of-type", "nth-last-child"].includes(name)) {
        if (arg === null) throw unsupported(selector, `:${name} needs an argument`);
        c.pseudos.push({ name, nth: parseNth(arg, selector) });
      } else if (["first-child", "last-child", "only-child", "first-of-type", "last-of-type", "only-of-type"].includes(name) && arg === null) {
        c.pseudos.push({ name });
      } else throw unsupported(selector, `:${name}`);
    } else break;
  }
  if (!c.tag && !c.ids.length && !c.classes.length && !c.attrs.length && !c.pseudos.length) throw unsupported(selector, `empty compound at ${i}`);
  return { ...c, end: i };
}

// A selector list -> [[{compound, combinator}]], each complex selector left to right; `combinator` joins a compound
// to the one before it (" ", ">", "+", "~"; null for the first).
export function parseSelector(selector) {
  if (typeof selector !== "string" || !selector.trim()) throw unsupported(String(selector), "empty");
  if (/[\\"'(),]/.test(selector.replace(/\((?:[^()"'\\,]*)\)/g, "").replace(/\[[^\]]*\]/g, ""))) {
    // Escapes, strings outside [..] or :nth(..), selector lists and nested functions are not read.
    throw unsupported(selector, "escapes, lists and functions other than :nth-*() are not read");
  }
  const s = selector.trim();
  const out = [];
  let i = 0;
  let combinator = null;
  for (;;) {
    const c = parseCompound(s, i, selector);
    out.push({ ...c, combinator });
    i = c.end;
    let ws = false;
    while (isSpace(s[i])) { i++; ws = true; }
    if (i >= s.length) break;
    if (">+~".includes(s[i])) {
      combinator = s[i];
      i++;
      while (isSpace(s[i])) i++;
      if (i >= s.length) throw unsupported(selector, "ends with a combinator");
    } else if (ws) combinator = " ";
    else throw unsupported(selector, `unexpected "${s[i]}" at ${i}`);
  }
  return [out];
}

function siblingsOf(el) {
  return el.parent ? childElements(el.parent) : [el];
}

function matchesCompound(el, c, ignoreClasses) {
  if (!isElement(el)) return false;
  if (c.tag && c.tag !== "*" && el.tag !== c.tag) return false;
  for (const id of c.ids) if (el.attrs.id !== id) return false;
  if (c.classes.length) {
    const have = new Set(classesOf(el));
    for (const cls of c.classes) if (!have.has(cls) && !ignoreClasses?.has(cls)) return false;
  }
  for (const a of c.attrs) {
    const v = el.attrs[a.name];
    if (v === undefined) return false;
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "~=" && !v.split(/\s+/).includes(a.value)) return false;
    if (a.op === "^=" && !v.startsWith(a.value)) return false;
    if (a.op === "$=" && !v.endsWith(a.value)) return false;
    if (a.op === "*=" && !v.includes(a.value)) return false;
    if (a.op === "|=" && v !== a.value && !v.startsWith(`${a.value}-`)) return false;
  }
  for (const p of c.pseudos) {
    const sibs = siblingsOf(el);
    const same = sibs.filter((x) => x.tag === el.tag);
    const pos = {
      "nth-child": sibs.indexOf(el) + 1,
      "nth-last-child": sibs.length - sibs.indexOf(el),
      "nth-of-type": same.indexOf(el) + 1,
      "nth-last-of-type": same.length - same.indexOf(el),
    };
    if (p.nth && !nthOk(p.nth, pos[p.name])) return false;
    if (p.name === "first-child" && pos["nth-child"] !== 1) return false;
    if (p.name === "last-child" && pos["nth-last-child"] !== 1) return false;
    if (p.name === "only-child" && sibs.length !== 1) return false;
    if (p.name === "first-of-type" && pos["nth-of-type"] !== 1) return false;
    if (p.name === "last-of-type" && pos["nth-last-of-type"] !== 1) return false;
    if (p.name === "only-of-type" && same.length !== 1) return false;
  }
  return true;
}

// Does `el` match compounds[0..k] (right to left)?
function matchesFrom(el, compounds, k, ignoreClasses) {
  if (!matchesCompound(el, compounds[k], ignoreClasses)) return false;
  if (k === 0) return true;
  const comb = compounds[k].combinator;
  if (comb === ">") return matchesFrom(el.parent, compounds, k - 1, ignoreClasses);
  if (comb === " ") {
    for (let up = el.parent; isElement(up); up = up.parent) if (matchesFrom(up, compounds, k - 1, ignoreClasses)) return true;
    return false;
  }
  const sibs = siblingsOf(el);
  const at = sibs.indexOf(el);
  if (comb === "+") return at > 0 && matchesFrom(sibs[at - 1], compounds, k - 1, ignoreClasses);
  for (let j = at - 1; j >= 0; j--) if (matchesFrom(sibs[j], compounds, k - 1, ignoreClasses)) return true;
  return false;
}

// Every element under `root` matching the complex selector given as compounds; `ignoreClasses` are class tests that
// always pass (classes the page adds while it plays).
export function matchCompounds(root, compounds, ignoreClasses) {
  const out = [];
  for (const el of walk(root)) if (matchesFrom(el, compounds, compounds.length - 1, ignoreClasses)) out.push(el);
  return out;
}

export function querySelectorAll(root, selector) {
  return parseSelector(selector).flatMap((compounds) => matchCompounds(root, compounds));
}
