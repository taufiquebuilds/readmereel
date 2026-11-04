import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, ftruncateSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject, counterText, LAYOUTS, prepareScreen } from "../skills/readmereel/scripts/lib/build.mjs";
import { planFilm } from "../skills/readmereel/scripts/lib/plan.mjs";
import { tmpDir, validStory2 } from "./helpers.mjs";

// The first bytes of real image files: copied images are checked by content, not by name.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const GIF = Buffer.from("GIF89a\x01\x00", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([8, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);

function onlyHookAndEnd() {
  const s = validStory2();
  s.scenes = [s.scenes[0], { type: "hook", lines: ["Second hook."] }, { type: "hook", lines: ["Third one."] }, { type: "hook", lines: ["Fourth."] }, { type: "end" }];
  return s;
}

// The JSON a scene file carries inside its root.
function sceneData(html) {
  const m = html.match(/<script type="application\/json" class="scene-data">([\s\S]*?)<\/script>/);
  return JSON.parse(m[1]);
}

test("layouts and output names", () => {
  assert.deepEqual(LAYOUTS.wide, { width: 1920, height: 1080, video: "video-16x9.mp4" });
  assert.deepEqual(LAYOUTS.tall, { width: 1080, height: 1920, video: "video-9x16.mp4" });
});

test("builds a root with one host per scene, overlapping by T", () => {
  const story = onlyHookAndEnd();
  const plan = planFilm(story);
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const root = readFileSync(join(dir, "index.html"), "utf8");
  assert.ok(root.includes(`data-duration="${plan.duration}"`));
  plan.scenes.forEach((s) => {
    assert.ok(root.includes(`data-composition-id="${s.id}"`));
    assert.ok(root.includes(`data-composition-src="compositions/${s.id}-${s.type}.html"`));
    assert.ok(root.includes(`data-start="${s.start}"`));
  });
  assert.deepEqual(readdirSync(join(dir, "compositions")).sort(), plan.scenes.map((s) => `${s.id}-${s.type}.html`).sort());
});

test("hosts paint later scenes over earlier ones and the root has no placeholders left", () => {
  // (Without carries: see the carry test below for the one exception.)
  const story = onlyHookAndEnd();
  const plan = planFilm(story);
  const dir = buildProject(story, "tall", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const root = readFileSync(join(dir, "index.html"), "utf8");
  plan.scenes.forEach((s, i) => {
    const host = root.match(new RegExp(`<div id="h-${s.id}"[^>]*>`))[0];
    assert.match(host, /style="z-index:\d+"/, host);
    assert.ok(host.includes(`data-duration="${s.duration}"`), host);
    assert.ok(host.includes('data-width="1080" data-height="1920"'), host);
  });
  assert.ok(root.includes(`background: ${plan.scenes[0].ground}`));
  assert.ok(!/__[A-Z]+__/.test(root), "every placeholder is replaced");
  // Consecutive scenes overlap by the transition length.
  for (let i = 1; i < plan.scenes.length; i++) {
    const prev = plan.scenes[i - 1];
    assert.ok(Math.abs(prev.start + prev.duration - plan.scenes[i].start - 0.35) < 0.02);
  }
});

test("each scene file carries its own data inside its root, safely escaped", () => {
  const story = onlyHookAndEnd();
  story.scenes[1].lines = ["</script> $& it's"];
  const plan = planFilm(story);
  const dir = buildProject(story, "tall", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const html = readFileSync(join(dir, "compositions/s2-hook.html"), "utf8");
  const rootStart = html.indexOf('data-composition-id="s2"');
  const dataAt = html.indexOf('class="scene-data"');
  assert.ok(rootStart > 0 && dataAt > rootStart, "data inside the root");
  assert.ok(!html.includes("</script> $&"), "closing tag escaped");
  assert.ok(html.includes("<\\/script> $& it's"));
  assert.ok(html.includes('data-width="1080"') && html.includes('data-height="1920"'));
  assert.ok(!/__[A-Z]+__/.test(html));
  assert.equal(sceneData(html).data.lines[0], "</script> $& it's", "the data stays parseable");
});

test("text slots are HTML-escaped and immune to replacement patterns", () => {
  const story = onlyHookAndEnd();
  story.scenes[0] = { type: "hook", lines: ["it's & <b>", "Pay $$$ less", "save $& $1 more"] };
  story.name = "it's & co";
  story.install = "npx a@1 && echo \"$'\"";
  const plan = planFilm(story);
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const hook = readFileSync(join(dir, "compositions/s1-hook.html"), "utf8");
  assert.ok(hook.includes('<div class="hook-line" data-field="scenes[0].lines[0]">it&#39;s &amp; &lt;b&gt;</div>'));
  assert.ok(hook.includes('data-field="scenes[0].lines[1]">Pay $$$ less</div>'));
  assert.ok(hook.includes('data-field="scenes[0].lines[2]">save $&amp; $1 more</div>'));
  const end = readFileSync(join(dir, "compositions/s5-end.html"), "utf8");
  assert.ok(end.includes('data-field="name">it&#39;s &amp; co</div>'));
  assert.ok(end.includes('data-field="install">npx a@1 &amp;&amp; echo &quot;$&#39;&quot;</span>'));
  assert.ok(end.includes('data-field="url">github.com/taufiquebuilds/agencyrecap</div>'));
  assert.ok(!/__[A-Z]+__/.test(hook) && !/__[A-Z]+__/.test(end));
});

test("a placeholder typed in the story is never replaced", () => {
  const story = onlyHookAndEnd();
  story.scenes[1].lines = ["__DATA__ __ID__"];
  const plan = planFilm(story);
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const html = readFileSync(join(dir, "compositions/s2-hook.html"), "utf8");
  assert.ok(html.includes('data-field="scenes[1].lines[0]">__DATA__ __ID__</div>'));
  assert.equal(sceneData(html).id, "s2");
});

test("scene files follow the contract: template, root id, layout and style classes, runtime", () => {
  // validStory2 has one scene of every type with a template so far (hook, title, list, counter, end).
  const story = { ...validStory2(), style: "paper" };
  const plan = planFilm(story);
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  for (const s of plan.scenes) {
    const html = readFileSync(join(dir, `compositions/${s.id}-${s.type}.html`), "utf8");
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes(`<div id="root" data-composition-id="${s.id}" data-width="1920" data-height="1080" data-layout="wide" data-style="paper">`));
    assert.ok(html.indexOf("<template>") < html.indexOf("<style>") && html.lastIndexOf("</template>") > html.lastIndexOf("</script>"));
    assert.ok(html.includes("var RR = (function () {"), "the runtime is inlined, one copy per scene");
    assert.ok(!html.includes("window.RR"), "never shared through window: each scene script gets its own scoped document");
    assert.ok(html.includes(`RR.scene("${s.id}")`));
    // HyperFrames rejects style rules keyed off the root's own classes: style hooks are attributes.
    assert.ok(!/#root\.|\.(wide|tall|style-\w+)\b/.test(html.slice(html.indexOf("<style>"), html.indexOf("</style>"))));
    const data = sceneData(html);
    assert.deepEqual(data, JSON.parse(JSON.stringify(s)));
  }
});

test("the end card shows the logo when there is one, else a glyph", () => {
  const base = tmpDir();
  writeFileSync(join(base, "logo.svg"), "<svg/>");
  const story = { ...onlyHookAndEnd(), logo: "logo.svg" };
  const dir = buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) });
  assert.equal(readFileSync(join(dir, "assets/logo.svg"), "utf8"), "<svg/>");
  assert.ok(readFileSync(join(dir, "compositions/s5-end.html"), "utf8").includes('<div class="end-badge"><img src="assets/logo.svg" alt=""></div>'));
  const bare = onlyHookAndEnd();
  const dir2 = buildProject(bare, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan: planFilm(bare) });
  assert.ok(readFileSync(join(dir2, "compositions/s5-end.html"), "utf8").includes('<div class="end-badge"><i class="glyph"></i></div>'));
});

test("rebuilding replaces the old project", () => {
  const story = onlyHookAndEnd();
  const out = tmpDir();
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: out, plan: planFilm(story) });
  assert.ok(existsSync(join(dir, "hyperframes.json")));
  writeFileSync(join(dir, "stale.txt"), "old");
  buildProject(story, "wide", { baseDir: tmpDir(), outDir: out, plan: planFilm(story) });
  assert.ok(existsSync(join(dir, "index.html")));
  assert.ok(!existsSync(join(dir, "stale.txt")));
});

test("sound cues become audio tags for the effects that exist, copied with their credits", () => {
  const story = onlyHookAndEnd();
  const plan = planFilm(story);
  const sfx = tmpDir();
  writeFileSync(join(sfx, "impact-bass-1.mp3"), "not really audio");
  writeFileSync(join(sfx, "CREDITS.md"), "credits");
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan, sfxDir: sfx });
  const root = readFileSync(join(dir, "index.html"), "utf8");
  const tags = root.match(/<audio [^>]*><\/audio>/g) ?? [];
  const impacts = plan.cues.filter((c) => c.sound === "impact-bass-1");
  assert.equal(tags.length, impacts.length, "only cues whose file exists");
  const tag = tags[0];
  assert.ok(tag.includes('src="assets/sfx/impact-bass-1.mp3"'), tag);
  assert.ok(tag.includes(`data-start="${impacts[0].t}"`), tag);
  assert.ok(tag.includes('data-volume="0.75"'), tag);
  assert.ok(tag.includes('data-duration="2"'), "an unreadable file is given the 2 s cap");
  assert.ok(tag.includes(`data-automation='{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":1.6,"v":1},{"t":2,"v":0}]}]}'`), tag);
  assert.match(tag, /^<audio id="sfx-\d+" /);
  assert.equal(readFileSync(join(dir, "assets/sfx/impact-bass-1.mp3"), "utf8"), "not really audio");
  assert.equal(readFileSync(join(dir, "assets/sfx/CREDITS.md"), "utf8"), "credits");
  const none = buildProject(story, "tall", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  assert.ok(!readFileSync(join(none, "index.html"), "utf8").includes("<audio"));
});

test("a rebuilt screen is sanitized, scoped and its images copied into the project", () => {
  const base = tmpDir();
  mkdirSync(join(base, "screens/shots"), { recursive: true });
  writeFileSync(join(base, "screens/shots/a.png"), PNG);
  writeFileSync(join(base, "screens/bg.svg"), "<svg/>");
  writeFileSync(join(base, "screens/home.html"),
    `<style>.top{background:url("bg.svg")}</style><div class="top" onclick="x()"><img src="shots/a.png"><script>bad()</script></div>`);
  const project = tmpDir();
  mkdirSync(join(project, "assets"));
  const screen = prepareScreen({ type: "ui", html: "screens/home.html" }, "s3", { baseDir: base, projectDir: project });
  assert.ok(screen.html.includes('<img src="assets/screens/s3-1.png">'), screen.html);
  assert.ok(!screen.html.includes("onclick") && !screen.html.includes("script"));
  assert.ok(screen.css.includes('.screen-s3 .top{background:url("assets/screens/s3-2.svg")}'), screen.css);
  // Two wrappers: the screen's own root rules (html, body, :root) land on the inner .screen-s3; the outer frame, which
  // no screen rule can select, clips and contains it and cannot itself be moved, scaled or raised.
  assert.ok(screen.markup.startsWith('<div class="screen-frame-s3" style="position:relative!important;overflow:clip!important;contain:paint!important;transform:none!important;zoom:1!important;z-index:auto!important"><div class="screen-s3"><div class="top">'), screen.markup);
  assert.ok(screen.markup.endsWith("</div></div></div>"), screen.markup);
  assert.equal(screen.style, `<style>${screen.css}</style>`, "the screen's CSS gets its own <style> element");
  assert.deepEqual(readFileSync(join(project, "assets/screens/s3-1.png")), PNG);
  assert.equal(readFileSync(join(project, "assets/screens/s3-2.svg"), "utf8"), "<svg/>");
  writeFileSync(join(base, "screens/missing.html"), `<img src="nope.png">`);
  assert.throws(() => prepareScreen({ type: "ui", html: "screens/missing.html" }, "s4", { baseDir: base, projectDir: project }), /image not found: nope\.png/);
});

test("unknown layout and scene types without a template are errors", () => {
  const story = onlyHookAndEnd();
  assert.throws(() => buildProject(story, "square", { baseDir: tmpDir(), outDir: tmpDir(), plan: planFilm(story) }), /unknown layout: square/);
  const odd = onlyHookAndEnd();
  const plan = planFilm(odd);
  plan.scenes[1].type = "bogus";
  assert.throws(() => buildProject(odd, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan }), /no template for scene type "bogus"/);
});

// ---------- title, list and counter (Task 5) ----------

function sceneFile(story, layout, id, type, opts = {}) {
  const dir = buildProject(story, layout, { baseDir: opts.baseDir ?? tmpDir(), outDir: tmpDir(), plan: planFilm(story) });
  return readFileSync(join(dir, `compositions/${id}-${type}.html`), "utf8");
}

test("title: name, promise and badge are filled, escaped and mapped to their fields", () => {
  const story = validStory2();
  story.name = "it's & <co>";
  story.scenes[1].promise = "Reports that send $& themselves </script>";
  for (const layout of ["wide", "tall"]) {
    const html = sceneFile(story, layout, "s2", "title");
    assert.ok(html.includes('<div class="title-name hero" data-field="name">it&#39;s &amp; &lt;co&gt;</div>'), "name");
    assert.ok(html.includes('<div class="title-promise" data-field="scenes[1].promise">Reports that send $&amp; themselves &lt;/script&gt;</div>'), "promise");
    assert.ok(html.includes('<div class="title-badge" data-zoom-target><i class="glyph"></i></div>'), "glyph badge without a logo");
    assert.ok(!/__[A-Z][A-Z0-9_]*__/.test(html), "no placeholders left");
    assert.equal(sceneData(html).data.promise, "Reports that send $& themselves </script>");
  }
  const base = tmpDir();
  writeFileSync(join(base, "logo.png"), PNG);
  const html = sceneFile({ ...story, logo: "logo.png" }, "wide", "s2", "title", { baseDir: base });
  assert.ok(html.includes('<div class="title-badge" data-zoom-target><img src="assets/logo.png" alt=""></div>'));
});

test("list: three items, each with its index and its own field", () => {
  const story = validStory2();
  story.scenes[2].items = ["Branded <PDF>", "Never sends $$ twice", "it's free"];
  for (const layout of ["wide", "tall"]) {
    const html = sceneFile(story, layout, "s3", "list");
    const items = html.match(/<div class="list-item[^"]*" data-field="scenes\[2\]\.items\[\d\]">[^<]*<\/div>/g) ?? [];
    assert.equal(items.length, 3, "three items");
    assert.ok(html.includes('data-field="scenes[2].items[0]">Branded &lt;PDF&gt;</div>'));
    assert.ok(html.includes('data-field="scenes[2].items[1]">Never sends $$ twice</div>'));
    assert.ok(html.includes('<div class="list-item hero" data-field="scenes[2].items[2]">it&#39;s free</div>'), "the last item is the hero");
    assert.ok(html.includes('class="list-index"'), "index");
    assert.ok(!/__[A-Z][A-Z0-9_]*__/.test(html), "no placeholders left");
  }
});

test("counter: each item's value, suffix, label and note are filled and mapped; missing parts are left out", () => {
  const story = validStory2();
  story.scenes[3].items = [
    { value: 4812, label: "Sessions", suffix: "+", note: "up <10%>" },
    { value: 12.5, label: "Hours saved", suffix: "h" },
    { value: 7, label: "Clients & co" },
  ];
  for (const layout of ["wide", "tall"]) {
    const html = sceneFile(story, layout, "s4", "counter");
    assert.equal((html.match(/<div class="counter-item/g) ?? []).length, 3, "three items");
    assert.ok(html.includes('<span class="counter-value" data-field="scenes[3].items[0].value">4,812</span>'), "value, formatted");
    assert.ok(html.includes('<span class="counter-suffix" data-field="scenes[3].items[0].suffix">+</span>'), "suffix");
    assert.ok(html.includes('<div class="counter-label" data-field="scenes[3].items[0].label">Sessions</div>'), "label");
    assert.ok(html.includes('<div class="counter-note" data-field="scenes[3].items[0].note">up &lt;10%&gt;</div>'), "note");
    assert.ok(html.includes('data-field="scenes[3].items[1].value">12.5</span>'), "one decimal kept");
    assert.ok(html.includes('data-field="scenes[3].items[2].label">Clients &amp; co</div>'));
    assert.ok(!html.includes("items[1].note") && !html.includes("items[2].suffix") && !html.includes("items[2].note"), "absent fields are not drawn");
    assert.ok(html.includes('data-zoom-target'), "the first value is the zoom target");
    assert.ok(!/__[A-Z][A-Z0-9_]*__/.test(html), "no placeholders left");
  }
});

// ---------- security round 2: copied images ----------

function screenBase(files) {
  const base = tmpDir();
  mkdirSync(join(base, "screens/shots"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(base, rel), body);
  return base;
}
const prep = (base, html = "screens/home.html", id = "s5") => {
  const project = tmpDir();
  return prepareScreen({ type: "ui", html }, id, { baseDir: base, projectDir: project, field: "scenes[4].html" });
};

test("screen images: a symlink, or a path that resolves outside the project, is refused and names the field", () => {
  const outside = tmpDir();
  writeFileSync(join(outside, "secret.png"), PNG);
  const base = screenBase({ "screens/home.html": '<img src="shots/a.png">' });
  symlinkSync(join(outside, "secret.png"), join(base, "screens/shots/a.png"));
  assert.throws(() => prep(base), /^Error: scenes\[4\]\.html: image is a symbolic link: shots\/a\.png$/);
  // a symlink in the CSS
  const css = screenBase({ "screens/home.html": '<style>p{background:url(bg.png)}</style><p>x</p>' });
  symlinkSync(join(outside, "secret.png"), join(css, "screens/bg.png"));
  assert.throws(() => prep(css), /scenes\[4\]\.html: image is a symbolic link: bg\.png/);
  // a symlinked folder: the file itself is plain, but its real path is outside the project
  const dir = screenBase({ "screens/home.html": '<img src="pics/secret.png">' });
  symlinkSync(outside, join(dir, "screens/pics"));
  assert.throws(() => prep(dir), /scenes\[4\]\.html: image is outside the project folder: pics\/secret\.png/);
  // the screen file itself
  const self = screenBase({});
  writeFileSync(join(outside, "page.html"), "<p>secret</p>");
  symlinkSync(join(outside, "page.html"), join(self, "screens/home.html"));
  assert.throws(() => prep(self), /scenes\[4\]\.html: the screen file is a symbolic link/);
});

test("screen images: the file must really be the image its name says", () => {
  const fake = screenBase({ "screens/home.html": '<img src="shots/a.png">', "screens/shots/a.png": "<!doctype html><script>x()</script>" });
  assert.throws(() => prep(fake), /^Error: scenes\[4\]\.html: image is not a PNG file: shots\/a\.png$/);
  const wrong = screenBase({ "screens/home.html": '<img src="shots/a.jpg">', "screens/shots/a.jpg": PNG });
  assert.throws(() => prep(wrong), /scenes\[4\]\.html: image is not a JPEG file: shots\/a\.jpg/);
  const svg = screenBase({ "screens/home.html": '<img src="shots/a.svg">', "screens/shots/a.svg": "<html>no</html>" });
  assert.throws(() => prep(svg), /scenes\[4\]\.html: image is not an SVG file: shots\/a\.svg/);
  const empty = screenBase({ "screens/home.html": '<img src="shots/a.gif">', "screens/shots/a.gif": "" });
  assert.throws(() => prep(empty), /image is not a GIF file/);
  const ok = screenBase({
    "screens/home.html": '<img src="shots/a.png"><img src="shots/b.JPG"><img src="shots/c.jpeg"><img src="shots/d.gif"><img src="shots/e.webp"><img src="shots/f.svg">',
    "screens/shots/a.png": PNG, "screens/shots/b.JPG": JPEG, "screens/shots/c.jpeg": JPEG, "screens/shots/d.gif": GIF, "screens/shots/e.webp": WEBP,
    "screens/shots/f.svg": '<?xml version="1.0"?>\n<SVG xmlns="http://www.w3.org/2000/svg"></SVG>',
  });
  const screen = prep(ok);
  for (const k of [1, 2, 3, 4, 5, 6]) assert.ok(screen.html.includes(`assets/screens/s5-${k}.`), screen.html);
});

test("logo: a symlink, a path outside the project or a fake image is refused as the logo field", () => {
  const story = { ...onlyHookAndEnd(), logo: "logo.png" };
  const build = (base) => buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) });
  const outside = tmpDir();
  writeFileSync(join(outside, "secret.png"), PNG);
  const link = tmpDir();
  symlinkSync(join(outside, "secret.png"), join(link, "logo.png"));
  assert.throws(() => build(link), /^Error: logo: image is a symbolic link: logo\.png$/);
  const fake = tmpDir();
  writeFileSync(join(fake, "logo.png"), "not a png");
  assert.throws(() => build(fake), /^Error: logo: image is not a PNG file: logo\.png$/);
  const missing = tmpDir();
  assert.throws(() => build(missing), /^Error: logo: image not found: logo\.png$/);
  const up = { ...story, logo: "../secret.png" };
  const nested = join(outside, "proj");
  mkdirSync(nested);
  assert.throws(() => buildProject(up, "wide", { baseDir: nested, outDir: tmpDir(), plan: planFilm(up) }), /logo: image is outside the project folder/);
});

// ---------- security round 3: screen file and image limits ----------

const BUILD_URL = new URL("../skills/readmereel/scripts/lib/build.mjs", import.meta.url).href;
// Runs prepareScreen in a child process with a time limit, so a read that blocks (a FIFO) fails the test instead of
// hanging the run. Returns the error message, or "ok".
function prepInChild(base) {
  const code = `import { prepareScreen } from ${JSON.stringify(BUILD_URL)};
    import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
    try { prepareScreen({ type: "ui", html: "screens/home.html" }, "s5", { baseDir: ${JSON.stringify(base)}, projectDir: mkdtempSync(join(tmpdir(), "rr-")), field: "scenes[4].html" }); console.log("ok"); }
    catch (e) { console.log(e.message); }`;
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf8", timeout: 10000 });
  return r.error ? `child failed: ${r.error.code}` : r.stdout.trim();
}
const mkfifo = (path) => assert.equal(spawnSync("mkfifo", [path]).status, 0, "mkfifo");

test("round 3 G/H: a FIFO as the screen file or as an image is refused without reading it", () => {
  const screen = screenBase({});
  mkfifo(join(screen, "screens/home.html"));
  assert.equal(prepInChild(screen), "scenes[4].html: the screen file is not a file: screens/home.html");
  const image = screenBase({ "screens/home.html": '<img src="shots/a.png">' });
  mkfifo(join(image, "screens/shots/a.png"));
  assert.equal(prepInChild(image), "scenes[4].html: image is not a file: shots/a.png");
});

test("round 3 H: a screen file over 256 KB is refused before it is read", () => {
  const big = screenBase({});
  const fd = openSync(join(big, "screens/home.html"), "w");
  ftruncateSync(fd, 256 * 1024 + 1); // sparse: refusing it must not depend on reading it
  closeSync(fd);
  assert.throws(() => prep(big), { message: "scenes[4].html: the screen file is over 256 KB: screens/home.html" });
  const edge = screenBase({ "screens/home.html": "<p>" + "a".repeat(256 * 1024 - 3) });
  assert.ok(prep(edge).html.startsWith("<p>aaa"), "exactly 256 KB is allowed");
});

test("round 3 I: image references are replaced in one pass, exactly, and capped at 64 images", () => {
  const files = { "screens/home.html": "" };
  let html = "<style>.x{background:url(img/0.png)} .y{background:url(\"img/1.png\"),url(img/10.png)}</style>";
  for (let k = 0; k < 64; k++) {
    files[`screens/img/${k}.png`] = PNG;
    html += `<img src="img/${k}.png" alt="img/${k}.png" title="img/${k}.png">`;
  }
  html += `<p style="background:url(img/1.png)">t</p>`;
  const base = screenBase({});
  mkdirSync(join(base, "screens/img"));
  for (const [rel, body] of Object.entries({ ...files, "screens/home.html": html })) writeFileSync(join(base, rel), body);
  const screen = prep(base);
  for (let k = 0; k < 64; k++) {
    assert.ok(screen.html.includes(`<img src="assets/screens/s5-${k + 1}.png" alt="img/${k}.png" title="img/${k}.png">`), `img ${k}`);
  }
  assert.ok(screen.html.includes('<p style="background:url(&quot;assets/screens/s5-2.png&quot;)">'), screen.html.slice(-200));
  assert.ok(screen.css.includes('.screen-s5 .x{background:url("assets/screens/s5-1.png")}'), screen.css);
  assert.ok(screen.css.includes('.screen-s5 .y{background:url("assets/screens/s5-2.png"),url("assets/screens/s5-11.png")}'), screen.css);
  // one more image is refused
  writeFileSync(join(base, "screens/img/64.png"), PNG);
  writeFileSync(join(base, "screens/home.html"), `${html}<img src="img/64.png">`);
  assert.throws(() => prep(base), { message: "scenes[4].html: the screen uses more than 64 images" });
});

test("round 3 I: thousands of image references stay fast", () => {
  const base = screenBase({ "screens/shots/a.png": PNG });
  writeFileSync(join(base, "screens/home.html"), '<img src="shots/a.png">'.repeat(9000));
  const t = performance.now();
  const screen = prep(base);
  assert.ok(performance.now() - t < 1500, `took ${(performance.now() - t).toFixed(0)} ms`);
  assert.equal(screen.html.split("assets/screens/s5-1.png").length - 1, 9000);
});

test("round 3 J: a hard-linked image or screen file is refused", () => {
  const outside = tmpDir();
  writeFileSync(join(outside, "secret.png"), PNG);
  const img = screenBase({ "screens/home.html": '<img src="shots/a.png">' });
  linkSync(join(outside, "secret.png"), join(img, "screens/shots/a.png"));
  assert.throws(() => prep(img), { message: "scenes[4].html: image has other hard links (refused, it may be a file from outside the project): shots/a.png" });
  const page = screenBase({});
  writeFileSync(join(outside, "page.html"), "<p>secret</p>");
  linkSync(join(outside, "page.html"), join(page, "screens/home.html"));
  assert.throws(() => prep(page), /scenes\[4\]\.html: the screen file has other hard links/);
  const story = { ...onlyHookAndEnd(), logo: "logo.png" };
  const logo = tmpDir();
  linkSync(join(outside, "secret.png"), join(logo, "logo.png"));
  assert.throws(() => buildProject(story, "wide", { baseDir: logo, outDir: tmpDir(), plan: planFilm(story) }), /^Error: logo: image has other hard links/);
});

// ---------- security round 4: files are opened once ----------

test("round 4 L: an image over 25 MB is refused from the open file, before it is copied", () => {
  const base = screenBase({ "screens/home.html": '<img src="shots/a.png">' });
  const fd = openSync(join(base, "screens/shots/a.png"), "w");
  writeFileSync(fd, PNG);
  ftruncateSync(fd, 25 * 1024 * 1024 + 1);
  closeSync(fd);
  assert.throws(() => prep(base), { message: "scenes[4].html: image is over 25 MB: shots/a.png" });
  const ok = screenBase({ "screens/home.html": '<img src="shots/a.png">', "screens/shots/a.png": PNG });
  const project = tmpDir();
  prepareScreen({ type: "ui", html: "screens/home.html" }, "s5", { baseDir: ok, projectDir: project, field: "scenes[4].html" });
  assert.deepEqual(readFileSync(join(project, "assets/screens/s5-1.png")), PNG, "the copy is the bytes that were checked");
});

// ---------- ui (Task 6) ----------

// A PNG whose header says w x h (the build reads the size from it, after copying).
function pngOf(w, h) {
  const b = Buffer.alloc(33);
  PNG.copy(b, 0, 0, 8);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12, "latin1");
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

// A story with an image ui (scenes[2]) and an HTML ui (scenes[3]), and a folder holding their files.
function uiStory() {
  const base = tmpDir();
  mkdirSync(join(base, "shots"));
  mkdirSync(join(base, "screens/img"), { recursive: true });
  writeFileSync(join(base, "shots/dash.png"), pngOf(1600, 1000));
  writeFileSync(join(base, "screens/img/logo.png"), PNG);
  writeFileSync(join(base, "screens/dash.html"),
    `<style>body{background:#fff} .sent .was{opacity:0} #st2 .now{color:green}</style>
<main><img src="img/logo.png"><table><tr><td><div class="status" id="st1"><span class="was">Scheduled</span><span class="now"><span class="tick">✓</span>Sent</span></div></td></tr>
<tr><td><div class="status" id="st2" onclick="x()"><span class="was">Scheduled</span><span class="now"><span class="tick">✓</span>Sent</span></div></td></tr></table></main><script>bad()</script>`);
  const story = validStory2();
  story.scenes.splice(2, 0,
    { type: "ui", image: "shots/dash.png", focus: [{ box: [100, 200, 400, 300], label: "07:00 on the <4th>" }, { box: [800, 0, 800, 1000] }], caption: "Sent. By itself." },
    { type: "ui", html: "screens/dash.html", focus: [{ box: [600, 100, 500, 300], label: "Status" }],
      states: [{ at: 1.2, selector: ".status", set: "sent" }, { at: 1.8, selector: "#st2", set: "seen" }], caption: "Sent & done" });
  story.scenes.splice(4, 1); // drop the list: 6 scenes
  return { story, base };
}
const uiFiles = (layout = "wide") => {
  const { story, base } = uiStory();
  const plan = planFilm(story);
  const dir = buildProject(story, layout, { baseDir: base, outDir: tmpDir(), plan });
  return { dir, plan, img: readFileSync(join(dir, "compositions/s3-ui.html"), "utf8"), html: readFileSync(join(dir, "compositions/s4-ui.html"), "utf8") };
};

test("ui image: the image is copied, shown in the window body, and its size gives the box scale and offsets", () => {
  for (const layout of ["wide", "tall"]) {
    const { dir, img } = uiFiles(layout);
    assert.deepEqual(readFileSync(join(dir, "assets/screens/s3.png")), pngOf(1600, 1000));
    assert.ok(img.includes('<img class="ui-shot" src="assets/screens/s3.png" alt="">'), "the shot fills the window body");
    // 1600 x 1000 contained in the 1460 x 806 body: height-bound, centred across.
    const scale = 806 / 1000;
    assert.deepEqual(sceneData(img).data.view, { width: 1600, height: 1000, scale, x: Number(((1460 - 1600 * scale) / 2).toFixed(4)), y: 0 });
    // Image mode has no screen: the screen slots are empty, with no stray tokens.
    assert.ok(!img.includes("screen-frame-") && !img.includes("screen-s3"), "no screen markup");
    assert.ok(!/__[A-Z][A-Z0-9_]*__/.test(img), "no placeholders left");
  }
});

test("ui image: a wide image is width-bound and centred down the body", () => {
  const { story, base } = uiStory();
  writeFileSync(join(base, "shots/dash.png"), pngOf(2920, 806));
  const dir = buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) });
  const view = sceneData(readFileSync(join(dir, "compositions/s3-ui.html"), "utf8")).data.view;
  assert.deepEqual(view, { width: 2920, height: 806, scale: 0.5, x: 0, y: Number(((806 - 403) / 2).toFixed(4)) });
});

test("ui image: a symlinked or fake image is refused and names the field", () => {
  const { story, base } = uiStory();
  writeFileSync(join(base, "shots/dash.png"), "<html>not a png</html>");
  assert.throws(() => buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) }),
    /^Error: scenes\[2\]\.image: image is not a PNG file: shots\/dash\.png$/);
  const outside = tmpDir();
  writeFileSync(join(outside, "secret.png"), pngOf(10, 10));
  rmSync(join(base, "shots/dash.png"));
  symlinkSync(join(outside, "secret.png"), join(base, "shots/dash.png"));
  assert.throws(() => buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) }),
    /^Error: scenes\[2\]\.image: image is a symbolic link: shots\/dash\.png$/);
});

test("ui html: the sanitized screen sits in the window body inside its fixed frame, with its own scoped style", () => {
  for (const layout of ["wide", "tall"]) {
    const { dir, html } = uiFiles(layout);
    const body = html.match(/<div class="ui-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/div>\s*<div class="ui-target"/);
    assert.ok(body, "the screen is inside .ui-body");
    assert.ok(body[1].startsWith('<div class="screen-frame-s4" style="position:relative!important;'), body[1].slice(0, 120));
    assert.ok(body[1].includes('<div class="screen-s4"><main><img src="assets/screens/s4-1.png">'), "images rewritten to their copies");
    assert.ok(!html.includes("onclick") && !html.includes("bad()"), "sanitized");
    assert.ok(html.includes('id="screen-s4-st1"'), "ids are scoped");
    assert.deepEqual(readFileSync(join(dir, "assets/screens/s4-1.png")), PNG);
    // The screen's CSS is its own <style> element, scoped to .screen-s4, after the scene's stylesheet.
    const styles = html.match(/<style>[\s\S]*?<\/style>/g);
    assert.equal(styles.length, 2);
    assert.ok(styles[1].includes(".screen-s4 .sent .was{opacity:0}"), styles[1]);
    assert.ok(!html.includes('class="ui-shot"'), "no shot in html mode");
    assert.deepEqual(sceneData(html).data.view, { width: 1460, height: 806, scale: 1, x: 0, y: 0 });
    assert.ok(!/__[A-Z][A-Z0-9_]*__/.test(html), "no placeholders left");
  }
});

test("ui html: states reach the scene data with selectors scoped to the screen", () => {
  const { html } = uiFiles();
  assert.deepEqual(sceneData(html).data.states, [
    { at: 1.2, selector: ".status", set: "sent", match: ".screen-s4 .status" },
    { at: 1.8, selector: "#st2", set: "seen", match: ".screen-s4 #screen-s4-st2" },
  ]);
});

test("ui html: a state selector that cannot be scoped to the screen is refused and names the field", () => {
  for (const [selector, why] of [["a{} b", "one CSS selector"], ["@media x", "one CSS selector"], ["", "one CSS selector"]]) {
    const { story, base } = uiStory();
    story.scenes[3].states = [{ at: 1, selector, set: "sent" }];
    assert.throws(() => buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) }),
      new RegExp(`^Error: scenes\\[3\\]\\.states\\[0\\]\\.selector: .*${why}`), selector);
  }
});

test("ui: chips, caption and the window's URL are filled, escaped and mapped to their fields", () => {
  for (const layout of ["wide", "tall"]) {
    const { img, html } = uiFiles(layout);
    assert.ok(img.includes('<div class="ui-chip" data-focus="0"><i class="dot"></i><span data-field="scenes[2].focus[0].label">07:00 on the &lt;4th&gt;</span></div>'), "chip");
    assert.ok(!img.includes('data-focus="1"'), "a focus without a label has no chip");
    assert.ok(img.includes('<div class="ui-caption" data-field="scenes[2].caption">Sent. By itself.</div>'), "caption");
    assert.ok(html.includes('<div class="ui-caption" data-field="scenes[3].caption">Sent &amp; done</div>'));
    // The window's address pill shows the repo URL's host; it is product chrome (UI text) for the gate.
    assert.ok(img.includes('<span class="ui-url" data-ui-text data-layout-ignore>github.com</span>'), "url host");
    // The caption's fade and the chips cover the screen on purpose.
    assert.ok(img.includes('<div class="ui-fade" data-layout-allow-occlusion></div>') && img.includes('<div class="ui-chips" data-layout-allow-occlusion>'));
    assert.ok(img.includes('<div class="ui-win hero">'), "the window is the hero");
    assert.ok(img.includes('<div class="ui-target" data-zoom-target'), "an invisible zoom target");
  }
});

test("ui: without a caption the caption block is left out", () => {
  const { story, base } = uiStory();
  delete story.scenes[2].caption;
  const dir = buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) });
  const img = readFileSync(join(dir, "compositions/s3-ui.html"), "utf8");
  assert.ok(!img.includes('class="ui-caption"') && !img.includes('class="ui-capwrap"'), "no caption block");
  assert.ok(!/__[A-Z][A-Z0-9_]*__/.test(img));
});

test("ui scene files follow the contract (the build adds only view, and scoped states, to the plan's data)", () => {
  const { story, base } = uiStory();
  const plan = planFilm(story);
  const dir = buildProject(story, "tall", { baseDir: base, outDir: tmpDir(), plan });
  for (const s of plan.scenes.filter((x) => x.type === "ui")) {
    const html = readFileSync(join(dir, `compositions/${s.id}-ui.html`), "utf8");
    assert.ok(html.includes(`<div id="root" data-composition-id="${s.id}" data-width="1080" data-height="1920" data-layout="tall" data-style="midnight">`));
    assert.ok(html.includes(`RR.scene("${s.id}")`) && html.includes("var RR = (function () {"));
    assert.ok(!/#root\.|\.(wide|tall|style-\w+)\b/.test(html.slice(html.indexOf("<style>"), html.indexOf("</style>"))));
    const data = sceneData(html);
    const { view, states, ...rest } = data.data;
    const { states: planStates, ...planRest } = JSON.parse(JSON.stringify(s.data));
    assert.deepEqual({ ...data, data: rest }, { ...JSON.parse(JSON.stringify(s)), data: planRest });
    assert.ok(view);
    if (planStates) assert.deepEqual(states.map(({ match, ...st }) => st), planStates);
  }
});

test("counter values in the HTML use the runtime's rule: at most one decimal, cut, never rounded up", () => {
  assert.equal(counterText(4812), "4,812");
  assert.equal(counterText(12.5), "12.5");
  assert.equal(counterText(99.95), "99.9");
  assert.equal(counterText(-0.5), "-0.5");
  assert.equal(counterText(-9999999), "-9,999,999");
  assert.equal(counterText(999999.9), "999,999.9");
});

test("hosts: each scene paints over the one before, but a scene leaving by carry stays above the next", () => {
  const story = onlyHookAndEnd();
  const plan = planFilm(story);
  plan.scenes[1].out = "carry";
  plan.scenes[2].in = "carry";
  const dir = buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const root = readFileSync(join(dir, "index.html"), "utf8");
  const zOf = (r) => plan.scenes.map((s) => Number(r.match(new RegExp(`<div id="h-${s.id}"[^>]*z-index:(\\d+)`))[1]));
  const ordered = (zs, scenes) => scenes.slice(0, -1).every((s, i) => (s.out === "carry" ? zs[i] > zs[i + 1] : zs[i] < zs[i + 1]));
  const z = zOf(root);
  assert.ok(z[1] > z[2], `carry out of s2 stays above s3: ${z}`);
  assert.ok(ordered(z, plan.scenes), `otherwise later is higher: ${z}`);
  // Two carries in a row (forced plans can do it) still stack: each above the next.
  plan.scenes[2].out = "carry";
  plan.scenes[3].in = "carry";
  const z2 = zOf(readFileSync(join(buildProject(story, "wide", { baseDir: tmpDir(), outDir: tmpDir(), plan }), "index.html"), "utf8"));
  assert.ok(ordered(z2, plan.scenes) && z2[1] > z2[3], `${z2}`);
});

// ---------- animated images are refused (a film frame must not depend on when it is drawn) ----------

const chunk = (type, body = Buffer.alloc(0)) => {
  const b = Buffer.alloc(12 + body.length);
  b.writeUInt32BE(body.length, 0);
  b.write(type, 4, "latin1");
  body.copy(b, 8);
  return b;
};
const IHDR = chunk("IHDR", Buffer.from([0, 0, 0, 10, 0, 0, 0, 10, 8, 6, 0, 0, 0]));
const APNG = Buffer.concat([PNG.subarray(0, 8), IHDR, chunk("acTL", Buffer.alloc(8)), chunk("IDAT", Buffer.alloc(4)), chunk("IEND")]);
const STILL_PNG = Buffer.concat([PNG.subarray(0, 8), IHDR, chunk("IDAT", Buffer.alloc(4)), chunk("IEND")]);
// GIF: header, a 1x1 screen without a colour table, then image descriptors (each with a 1-byte LZW minimum and an empty data block).
const gifOf = (frames) => Buffer.concat([Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "latin1"),
  ...Array.from({ length: frames }, () => Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 0])), Buffer.from([0x3b])]);
const webpX = (flags) => Buffer.concat([Buffer.from("RIFF"), Buffer.from([30, 0, 0, 0]), Buffer.from("WEBPVP8X"), Buffer.from([10, 0, 0, 0, flags, 0, 0, 0, 9, 0, 0, 9, 0, 0])]);

test("animated images are refused wherever they enter: screen images, inline data images, the ui shot and the logo", () => {
  const animated = {
    "a.png": APNG, "b.gif": gifOf(2), "c.webp": webpX(0x02),
    "d.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect><animate attributeName="x" to="9" dur="1s"/></rect></svg>',
    "e.svg": '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="fill" to="red"/></svg>',
    "f.svg": '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{animation:spin 1s infinite}@keyframes spin{to{opacity:0}}</style><rect/></svg>',
  };
  for (const [name, body] of Object.entries(animated)) {
    const base = screenBase({ "screens/home.html": `<img src="shots/${name}">`, [`screens/shots/${name}`]: body });
    assert.throws(() => prep(base), new RegExp(`^Error: scenes\\[4\\]\\.html: image is animated \\(a film frame must not depend on when it is drawn\\): shots/${name.replace(".", "\\.")}$`), name);
  }
  // The same files, still, are fine.
  const still = screenBase({ "screens/home.html": '<img src="shots/a.png"><img src="shots/b.gif"><img src="shots/c.webp"><img src="shots/d.svg">',
    "screens/shots/a.png": STILL_PNG, "screens/shots/b.gif": gifOf(1), "screens/shots/c.webp": webpX(0x10), "screens/shots/d.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>' });
  assert.ok(prep(still).html.includes("assets/screens/s5-4.svg"));
  // An inline data image is checked too.
  const inline = screenBase({ "screens/home.html": `<img src="data:image/gif;base64,${gifOf(3).toString("base64")}">` });
  assert.throws(() => prep(inline), /^Error: scenes\[4\]\.html: image is animated \(a film frame must not depend on when it is drawn\): an inline data image$/);
  // The ui shot and the logo.
  const { story, base } = uiStory();
  writeFileSync(join(base, "shots/dash.png"), APNG);
  assert.throws(() => buildProject(story, "wide", { baseDir: base, outDir: tmpDir(), plan: planFilm(story) }), /^Error: scenes\[2\]\.image: image is animated/);
  const logo = { ...onlyHookAndEnd(), logo: "logo.png" };
  const lbase = tmpDir();
  writeFileSync(join(lbase, "logo.png"), APNG);
  assert.throws(() => buildProject(logo, "wide", { baseDir: lbase, outDir: tmpDir(), plan: planFilm(logo) }), /^Error: logo: image is animated/);
});

test("animated SVG is found through CSS escapes, entities and comments, and inline data images through spacing and entities", () => {
  const svgs = {
    // CSS escapes (the reviewer's a3.svg): \61nimation-name and @\6b eyframes.
    "a3.svg": '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{\\61nimation-name:s;animation-duration:1s}@\\6b eyframes s{to{opacity:0}}</style><rect/></svg>',
    "esc.svg": '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{\\61 nimation:s 1s}</style><rect/></svg>',
    "ent.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect style="&#97;nimation:s 1s"/></svg>',
    "cmt.svg": '<svg xmlns="http://www.w3.org/2000/svg"><style>rect{/*x*/animation/**/:s 1s}</style><rect/></svg>',
    "tag.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect><&#x61;nimate/></rect><svg:animate/></svg>',
  };
  for (const [name, body] of Object.entries(svgs)) {
    const base = screenBase({ "screens/home.html": `<img src="shots/${name}">`, [`screens/shots/${name}`]: body });
    assert.throws(() => prep(base), /image is animated/, name);
  }
  // Inline data images: base64 broken over lines, or an SVG data URL with entities in its attribute.
  const b64 = gifOf(2).toString("base64");
  const spaced = screenBase({ "screens/home.html": `<img src="data:image/gif;base64,${b64.slice(0, 10)}\n  ${b64.slice(10)}">` });
  assert.throws(() => prep(spaced), /image is animated \(a film frame must not depend on when it is drawn\): an inline data image/);
  // (Only raster <img src> data images reach the build: the sanitizer drops data URLs in CSS and SVG data URLs.)
  const entity = screenBase({ "screens/home.html": `<img src="data:image/gif;base64,&#x${b64.charCodeAt(0).toString(16)};${b64.slice(1)}">` });
  assert.throws(() => prep(entity), /an inline data image/);
});
