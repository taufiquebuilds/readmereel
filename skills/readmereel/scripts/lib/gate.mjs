import { readFileSync } from "node:fs";
import { isAbsolute, join, normalize, sep } from "node:path";
import { classesOf, closest, contains, matchCompounds, parseHtml, parseSelector, textContent, walk } from "./dom.mjs";

// The quality gate's reading of a `hyperframes check --json` report. Any error blocks the render. These warnings block
// too when they are about readmereel's own scene text; inside a rebuilt `ui` screen (small UI text is allowed) and on
// text marked `data-ui-text` (terminal output, window chrome) they do not.
export const READABILITY = new Set(["line_unread", "text_below_floor", "contrast_aa_failure"]);

// Classes a scene adds while it plays to an element that is already in the page: the hook's last line becomes .hero.
// A ui scene's state classes come from its scene data and count only inside that scene.
const PLAYTIME_CLASSES = ["hero"];

// The built project as one tree, the way HyperFrames composes it: each scene file's <template> content mounted into its
// host element in index.html. `hosts` maps a scene file (as check's `sourceFile` names it) to its host.
export function loadProject(projectDir) {
  const doc = parseHtml(readFileSync(join(projectDir, "index.html"), "utf8"));
  const hosts = new Map();
  const added = new Map();
  for (const host of [...walk(doc)].filter((el) => el.attrs["data-composition-src"] !== undefined)) {
    const src = normalize(host.attrs["data-composition-src"]);
    if (isAbsolute(src) || src === ".." || src.startsWith(`..${sep}`)) throw new Error(`scene file outside the project: ${src}`);
    const sub = parseHtml(readFileSync(join(projectDir, src), "utf8"));
    const template = [...walk(sub)].find((el) => el.tag === "template");
    if (!template) throw new Error(`${src} has no <template>`);
    for (const child of template.children) {
      child.parent = host;
      host.children.push(child);
    }
    hosts.set(src, host);
    const classes = new Set(PLAYTIME_CLASSES);
    for (const script of [...walk(host)].filter((el) => el.tag === "script" && classesOf(el).includes("scene-data"))) {
      try {
        for (const st of JSON.parse(textContent(script))?.data?.states ?? []) if (typeof st?.set === "string") classes.add(st.set);
      } catch {
        // no states to read
      }
    }
    added.set(host, classes);
  }
  return { doc, hosts, added };
}

// A compound may drop a play-time class only if it still names the element by another class or an id.
const keepsName = (c, ignore) => c.ids.length > 0 || c.classes.some((cls) => !ignore.has(cls));

// The elements a check selector can stand for in the built project: the elements it matches, or, when it names
// something the page only makes while it plays (a word span, a rolled digit), the elements its longest matching
// ancestor path matches. Each step gives elements that are the finding's element or its ancestors, so what is true of
// all of them (inside a screen, inside UI text) is true of the finding's element. Returns [] when nothing is found.
export function locate(project, selector, sourceFile) {
  let compounds;
  try {
    [compounds] = parseSelector(selector);
  } catch {
    return [];
  }
  const host = typeof sourceFile === "string" ? project.hosts.get(normalize(sourceFile)) : undefined;
  const ignore = host ? project.added.get(host) : new Set(PLAYTIME_CLASSES);
  // check's contrast pass names an element by its path from <body> (bare tags): anchor that path at <body>.
  const first = compounds[0];
  if (!first.ids.length && !first.classes.length && !first.attrs.length) {
    compounds = [{ tag: "body", ids: [], classes: [], attrs: [], pseudos: [], combinator: null }, { ...first, combinator: ">" }, ...compounds.slice(1)];
  }
  const inScope = (el) => !host || contains(host, el);
  for (let n = compounds.length; n >= 1; n--) {
    // Only a child or descendant step can be cut off: what is left then matches an ancestor.
    if (n < compounds.length && ![">", " "].includes(compounds[n].combinator)) break;
    const part = compounds.slice(0, n);
    let found = matchCompounds(project.doc, part).filter(inScope);
    if (!found.length && part.every((c) => keepsName(c, ignore))) found = matchCompounds(project.doc, part, ignore).filter(inScope);
    if (found.length) return found;
  }
  return [];
}

const SCREEN_CLASS = /^screen-(?:frame-)?s\d+$/;
// Text inside a rebuilt ui screen (or its screenshot), or marked as UI text by a scene template.
export const isUiText = (el) =>
  closest(el, (x) => x.attrs["data-ui-text"] !== undefined || classesOf(x).some((c) => SCREEN_CLASS.test(c) || c === "ui-shot")) !== null;

const squash = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// The story field behind the elements a selector stands for, or, failing that, the one field in the same scene file
// whose text is the finding's text. Undefined when it is not one field.
export function fieldFor(project, found, text, sourceFile) {
  const fieldOf = (el) => closest(el, (x) => x.attrs["data-field"] !== undefined)?.attrs["data-field"];
  const fields = new Set(found.map(fieldOf));
  if (found.length && fields.size === 1 && !fields.has(undefined)) return [...fields][0];
  const want = squash(text);
  if (!want) return undefined;
  const host = typeof sourceFile === "string" ? project.hosts.get(normalize(sourceFile)) : undefined;
  const byText = new Set([...walk(host ?? project.doc)]
    .filter((el) => el.attrs["data-field"] !== undefined && !isUiText(el))
    .filter((el) => {
      const have = squash(textContent(el));
      return have && (have.includes(want) || want.includes(have));
    })
    .map((el) => el.attrs["data-field"]));
  return byText.size === 1 ? [...byText][0] : undefined;
}

const NOT_FOUND = " [not found in the built project, so it counts as scene text]";

// The report's blocking problems, as lines naming the element and, when known, the story field. `load` builds the
// project tree (see loadProject); it is called at most once, and only if a finding needs it. If it fails, every
// readability warning blocks.
export function gateProblems(report, load) {
  let project;
  const tree = () => {
    if (project === undefined) {
      try {
        project = load();
      } catch {
        project = null;
      }
    }
    return project;
  };
  const line = (section, f, detail, selector, found, text) => {
    const p = tree();
    const field = p ? fieldFor(p, found, text, f.sourceFile) : undefined;
    return `${section}: ${f.code}: ${detail}${selector ? ` (${selector})` : ""}${field ? ` -> story field: ${field}` : ""}`;
  };
  const problems = [];
  for (const [section, value] of Object.entries(report)) {
    if (!value || typeof value !== "object" || !Array.isArray(value.findings)) continue;
    for (const f of value.findings) {
      if (!f || typeof f !== "object") continue;
      if (f.severity === "error") {
        const p = f.selector ? tree() : null;
        problems.push(line(section, f, f.message, f.selector, p ? locate(p, f.selector, f.sourceFile) : [], f.text));
        continue;
      }
      if (f.severity !== "warning" || !READABILITY.has(f.code)) continue;
      const grouped = Array.isArray(f.elements) && f.elements.length > 0;
      for (const el of grouped ? f.elements : [f]) {
        const selector = typeof el?.selector === "string" ? el.selector : "";
        const p = tree();
        const found = p && selector ? locate(p, selector, f.sourceFile) : [];
        if (found.length && found.every(isUiText)) continue;
        const detail = grouped
          ? `"${squash(el.text)}" stays at ${Math.round(Number(el.fontPx))} px, under the ${f.floorPx ?? 28} px floor`
          : f.message;
        problems.push(line(section, f, detail, selector, found, el?.text) + (found.length ? "" : NOT_FOUND));
      }
    }
  }
  return problems;
}
