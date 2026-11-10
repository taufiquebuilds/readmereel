import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../skills/readmereel/scripts/lib/build.mjs";
import { childElements, classesOf, isElement, parseHtml, querySelectorAll, textContent, walk } from "../skills/readmereel/scripts/lib/dom.mjs";
import { gateProblems, isUiText, loadProject, locate } from "../skills/readmereel/scripts/lib/gate.mjs";
import { checkProject } from "../skills/readmereel/scripts/lib/hf.mjs";
import { planFilm } from "../skills/readmereel/scripts/lib/plan.mjs";
import { tmpDir, validStory2 } from "./helpers.mjs";

// ---------- dom ----------

test("the tree keeps raw text, void elements, self-closing SVG and decoded attributes", () => {
  const doc = parseHtml(`<!doctype html><div id="a" class="x  y" title="&quot;q&quot;"><img src=a.png><br><svg><path d="M0"/></svg><span>t &amp; u</span></div><script>if (a<b) "</div>";</script><p>z</p>`);
  const div = querySelectorAll(doc, "#a")[0];
  assert.deepEqual(classesOf(div), ["x", "y"]);
  assert.equal(div.attrs.title, '"q"');
  assert.deepEqual(childElements(div).map((e) => e.tag), ["img", "br", "svg", "span"]);
  assert.equal(textContent(querySelectorAll(doc, "span")[0]), "t & u");
  assert.equal(querySelectorAll(doc, "p").length, 1, "the script's text did not close anything");
});

test("selectors: compounds, combinators and :nth-* as a browser reads them", () => {
  const doc = parseHtml(`<main><div class="a"><span>1</span><i></i><span>2</span></div><div class="a b" data-k="v"><span>3</span></div><p></p></main>`);
  const texts = (sel) => querySelectorAll(doc, sel).map((e) => textContent(e) || e.tag);
  assert.deepEqual(texts("div.a > span:nth-of-type(2)"), ["2"]);
  assert.deepEqual(texts("div.a > span:nth-child(3)"), ["2"]);
  assert.deepEqual(texts("main span"), ["1", "2", "3"]);
  assert.deepEqual(texts("div.a.b > span"), ["3"]);
  assert.deepEqual(texts('[data-k="v"] span'), ["3"]);
  assert.deepEqual(texts("div + p"), ["p"]);
  assert.deepEqual(texts("span ~ span"), ["2"]);
  assert.deepEqual(texts("div:nth-of-type(2) > span:first-child"), ["3"]);
  for (const bad of ["div, p", "#a\\:b", "div:not(.a)", "div >", "> div", "div::before", ""]) {
    assert.throws(() => querySelectorAll(doc, bad), /unsupported selector/, bad);
  }
});

// ---------- the built project ----------

const SCREEN = `<style>.sent .was{opacity:0}</style>
<div class="top"><b>agencyrecap</b><span>Clients</span></div>
<table><tbody><tr><td id="row1"><span>team@cobalt.example</span></td><td><div class="status"><span class="was">Scheduled</span><span class="now">Sent</span></div></td></tr></tbody></table>`;

// hook, title, ui (html screen), terminal, end.
function project() {
  const base = tmpDir();
  mkdirSync(join(base, "screens"));
  writeFileSync(join(base, "screens/dash.html"), SCREEN);
  const story = validStory2();
  story.scenes = [
    { type: "hook", lines: ["40 clients.", "40 reports.", "Every month."] },
    { type: "title", promise: "Monthly client reports that send themselves" },
    { type: "ui", html: "screens/dash.html", focus: [{ box: [0, 0, 400, 300] }], states: [{ at: 1.2, selector: ".status", set: "sent" }], caption: "Sent by itself" },
    { type: "terminal", command: "repoheat dashboard", output: ["one", "two"] },
    { type: "end" },
  ];
  const plan = planFilm(story);
  const dir = buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan });
  return { dir, tree: loadProject(dir) };
}

test("the project tree mounts each scene file's template in its host, as HyperFrames composes it", () => {
  const { tree } = project();
  const [root1] = querySelectorAll(tree.doc, "#h-s1 > div:nth-of-type(1)");
  assert.equal(root1.attrs["data-composition-id"], "s1");
  assert.equal(querySelectorAll(tree.doc, "#h-s1 > div:nth-of-type(1) > div:nth-of-type(2)")[0].attrs["data-field"], "scenes[0].lines[1]");
  assert.equal(tree.hosts.get("compositions/s3-ui.html").attrs.id, "h-s3");
  assert.ok(tree.added.get(tree.hosts.get("compositions/s3-ui.html")).has("sent"), "state classes are read from the scene data");
});

test("locate: exact, through play-time classes, up to the nearest ancestor that exists, inside the finding's scene file", () => {
  const { tree } = project();
  const field = (els) => els.map((e) => e.attrs["data-field"]);
  const ui = "compositions/s3-ui.html";
  assert.deepEqual(field(locate(tree, "div.ui-caption", ui)), ["scenes[2].caption"]);
  // The runtime splits the caption into word spans: the span is not in the built page, its parent is.
  assert.deepEqual(field(locate(tree, "div.ui-caption > span:nth-of-type(2)", ui)), ["scenes[2].caption"]);
  // The hook's last line becomes .hero while it plays: every line that could be it.
  assert.deepEqual(field(locate(tree, "div.hook-line.hero > span:nth-of-type(1)", "compositions/s1-hook.html")), ["scenes[0].lines[0]", "scenes[0].lines[1]", "scenes[0].lines[2]"]);
  // A state class counts only in its own scene, and only next to a class the element already has.
  assert.equal(locate(tree, "div.status.sent > span:nth-of-type(1)", ui).length, 1);
  assert.equal(locate(tree, "div.status.sent", "compositions/s1-hook.html").length, 0);
  assert.equal(locate(tree, "span.w.acc", "compositions/s1-hook.html").length, 0, "a span made while playing is not found");
  assert.equal(locate(tree, "#a\\:b", ui).length, 0);
});

const ui = (selector, extra = {}) => ({ severity: "warning", code: "line_unread", message: "on screen too briefly", selector, sourceFile: "compositions/s3-ui.html", text: "x", ...extra });
const gate = (tree, findings, section = "craft") => gateProblems({ ok: true, [section]: { findings } }, () => tree);

test("readability warnings inside a rebuilt screen or on UI text pass", () => {
  const { tree } = project();
  const exempt = [
    ui("div.screen-s3 > table:nth-of-type(1) > tbody:nth-of-type(1) > tr:nth-of-type(1) > td:nth-of-type(1) > span:nth-of-type(1)"),
    // A class only the screen uses, an id the sanitizer scoped, and a state the scene set.
    ui("div.top > span:nth-of-type(1)"),
    ui("#screen-s3-row1 > span:nth-of-type(1)"),
    ui("div.status.sent > span:nth-of-type(2)"),
    ui("span.ui-url"),
    { ...ui("div.term-out > div:nth-of-type(2) > span:nth-of-type(1)"), sourceFile: "compositions/s4-terminal.html" },
    { ...ui("div.term-out > div:nth-of-type(1)"), code: "text_below_floor", sourceFile: "compositions/s4-terminal.html" },
  ];
  assert.deepEqual(gate(tree, exempt), []);
});

test("a selector that matches screen text and scene text in the same file blocks: every match must be UI text", () => {
  const doc = parseHtml('<div id="h"><div class="screen-s1"><b class="k">a</b></div><b class="k">b</b></div>');
  const [host] = querySelectorAll(doc, "#h");
  const project = { doc, hosts: new Map([["compositions/s1-ui.html", host]]), added: new Map([[host, new Set()]]) };
  assert.deepEqual(locate(project, "b.k", "compositions/s1-ui.html").map(textContent), ["a", "b"]);
  const finding = { severity: "warning", code: "line_unread", message: "brief", selector: "b.k", sourceFile: "compositions/s1-ui.html", text: "b" };
  assert.deepEqual(gateProblems({ craft: { findings: [finding] } }, () => project), ["craft: line_unread: brief (b.k)"]);
  // The same selector with only the screen's element matching passes.
  const screenOnly = parseHtml('<div id="h"><div class="screen-s1"><b class="k">a</b></div><b>b</b></div>');
  const [host2] = querySelectorAll(screenOnly, "#h");
  assert.deepEqual(gateProblems({ craft: { findings: [finding] } }, () => ({ doc: screenOnly, hosts: new Map([["compositions/s1-ui.html", host2]]), added: new Map([[host2, new Set()]]) })), []);
});

test("readability warnings on scene text block, naming the story field", () => {
  const { tree } = project();
  const problems = gate(tree, [
    ui("div.ui-caption > span:nth-of-type(1)", { message: '"Sent by itself" is on screen 0.6 s' }),
    { ...ui("#h-s1 > div:nth-of-type(1) > div:nth-of-type(2) > span:nth-of-type(1)"), sourceFile: "compositions/s1-hook.html" },
    { ...ui("div.title-promise"), code: "contrast_aa_failure", sourceFile: "compositions/s2-title.html", message: "contrast 3.1:1" },
  ]);
  assert.deepEqual(problems, [
    'craft: line_unread: "Sent by itself" is on screen 0.6 s (div.ui-caption > span:nth-of-type(1)) -> story field: scenes[2].caption',
    "craft: line_unread: on screen too briefly (#h-s1 > div:nth-of-type(1) > div:nth-of-type(2) > span:nth-of-type(1)) -> story field: scenes[0].lines[1]",
    "craft: contrast_aa_failure: contrast 3.1:1 (div.title-promise) -> story field: scenes[1].promise",
  ]);
});

test("a selector standing for several lines takes its field from the finding's text", () => {
  const { tree } = project();
  assert.deepEqual(gate(tree, [{ ...ui("div.hook-line.hero > span:nth-of-type(1)"), sourceFile: "compositions/s1-hook.html", text: "Every" }]),
    ["craft: line_unread: on screen too briefly (div.hook-line.hero > span:nth-of-type(1)) -> story field: scenes[0].lines[2]"]);
});

test("a selector that cannot be found or read blocks (fail closed), with the field found by its text when it can be", () => {
  const { tree } = project();
  const problems = gate(tree, [
    { ...ui("span.w.acc"), sourceFile: "compositions/s1-hook.html", text: "month." },
    ui("#a\\:b"),
    ui(undefined),
  ]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /\(span\.w\.acc\) -> story field: scenes\[0\]\.lines\[2\] \[not found in the built project, so it counts as scene text\]$/);
  assert.match(problems[1], /not found in the built project/);
  assert.match(problems[2], /^craft: line_unread: on screen too briefly \[not found/);
});

test("a grouped text_below_floor blocks once per scene-text element and ignores its screen elements", () => {
  const { tree } = project();
  const finding = {
    severity: "warning", code: "text_below_floor", message: "3 text elements stay under it", floorPx: 28, sourceFile: "compositions/s3-ui.html",
    selector: "div.top > b:nth-of-type(1)", text: "agencyrecap",
    elements: [
      { selector: "div.top > b:nth-of-type(1)", text: "agencyrecap", fontPx: 11.8 },
      { selector: "div.ui-chips", text: "x", fontPx: 26 },
      { selector: "div.ui-caption", text: "Sent by itself", fontPx: 24.4 },
    ],
  };
  assert.deepEqual(gate(tree, [finding]), [
    'craft: text_below_floor: "x" stays at 26 px, under the 28 px floor (div.ui-chips)',
    'craft: text_below_floor: "Sent by itself" stays at 24 px, under the 28 px floor (div.ui-caption) -> story field: scenes[2].caption',
  ]);
});

test("check's contrast paths from <body> are anchored there", () => {
  const { tree } = project();
  // The path HyperFrames' contrast pass prints for the title's promise: tags from below <body>, nth-of-type when needed.
  const [promise] = querySelectorAll(tree.doc, "div.title-promise");
  const parts = [];
  for (let el = promise; isElement(el) && el.tag !== "body"; el = el.parent) {
    const same = childElements(el.parent).filter((x) => x.tag === el.tag);
    parts.push(same.length > 1 ? `${el.tag}:nth-of-type(${same.indexOf(el) + 1})` : el.tag);
  }
  const path = parts.reverse().join(" > ");
  assert.deepEqual(locate(tree, path, "compositions/s2-title.html"), [promise]);
  assert.deepEqual(gate(tree, [{ severity: "warning", code: "contrast_aa_failure", message: "low", selector: path, sourceFile: "compositions/s2-title.html" }], "contrast"),
    [`contrast: contrast_aa_failure: low (${path}) -> story field: scenes[1].promise`]);
});

test("errors always block and name their field; other warnings never do", () => {
  const { tree } = project();
  assert.deepEqual(gate(tree, [
    { severity: "error", code: "text_overflow", message: "spills out", selector: "div.screen-s3 > div:nth-of-type(1)", sourceFile: "compositions/s3-ui.html" },
    { severity: "error", code: "text_overflow", message: "too wide", selector: "div.title-promise", sourceFile: "compositions/s2-title.html" },
    { severity: "warning", code: "content_overlap", message: "overlap", selector: "div.title-promise" },
    { severity: "info", code: "line_unread", message: "seen once", selector: "div.title-promise" },
  ], "layout"), [
    "layout: text_overflow: spills out (div.screen-s3 > div:nth-of-type(1))",
    "layout: text_overflow: too wide (div.title-promise) -> story field: scenes[1].promise",
  ]);
});

test("if the project cannot be read, readability warnings block and errors still print", () => {
  const broken = () => { throw new Error("no index.html"); };
  assert.deepEqual(gateProblems({ ok: false, layout: { findings: [
    { severity: "error", code: "x", message: "m", selector: "#a" },
    { severity: "warning", code: "line_unread", message: "brief", selector: "div.screen-s3 > span:nth-of-type(1)" },
  ] } }, broken), [
    "layout: x: m (#a)",
    "layout: line_unread: brief (div.screen-s3 > span:nth-of-type(1)) [not found in the built project, so it counts as scene text]",
  ]);
});

test("checkProject reads the built project for the gate", () => {
  const { dir } = project();
  const report = { ok: true, craft: { findings: [ui("div.top > span:nth-of-type(1)"), ui("div.ui-caption")] } };
  const run = () => ({ status: 0, stdout: JSON.stringify(report), stderr: "" });
  assert.deepEqual(checkProject(dir, { log: join(tmpDir(), "l"), run, duration: 20 }), [
    "craft: line_unread: on screen too briefly (div.ui-caption) -> story field: scenes[2].caption",
  ]);
});

test("isUiText: screen wrappers, the screenshot and data-ui-text, with their descendants", () => {
  const doc = parseHtml(`<div class="screen-frame-s2"><p>a</p></div><div class="screen-s10"><p>b</p></div><img class="ui-shot"><div data-ui-text><span>c</span></div><div class="myscreen-s2"><p>d</p></div>`);
  const ps = [...walk(doc)].filter((e) => ["p", "img", "span"].includes(e.tag));
  assert.deepEqual(ps.map(isUiText), [true, true, true, true, false]);
});
