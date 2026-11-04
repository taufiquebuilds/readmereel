import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject, LAYOUTS, prepareScreen } from "../skills/readmereel/scripts/lib/build.mjs";
import { planFilm } from "../skills/readmereel/scripts/lib/plan.mjs";
import { tmpDir, validStory2 } from "./helpers.mjs";

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
  const story = onlyHookAndEnd();
  const plan = planFilm(story);
  const dir = buildProject(story, "tall", { baseDir: tmpDir(), outDir: tmpDir(), plan });
  const root = readFileSync(join(dir, "index.html"), "utf8");
  plan.scenes.forEach((s, i) => {
    const host = root.match(new RegExp(`<div id="h-${s.id}"[^>]*>`))[0];
    assert.ok(host.includes(`style="z-index:${i + 1}"`), host);
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
  const story = { ...onlyHookAndEnd(), style: "paper" };
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
  writeFileSync(join(base, "screens/shots/a.png"), "png");
  writeFileSync(join(base, "screens/bg.svg"), "<svg/>");
  writeFileSync(join(base, "screens/home.html"),
    `<style>.top{background:url("bg.svg")}</style><div class="top" onclick="x()"><img src="shots/a.png"><script>bad()</script></div>`);
  const project = tmpDir();
  mkdirSync(join(project, "assets"));
  const screen = prepareScreen({ type: "ui", html: "screens/home.html" }, "s3", { baseDir: base, projectDir: project });
  assert.ok(screen.html.includes('<img src="assets/screens/s3-1.png">'), screen.html);
  assert.ok(!screen.html.includes("onclick") && !screen.html.includes("script"));
  assert.ok(screen.css.includes('.screen-s3 .top{background:url("assets/screens/s3-2.svg")}'), screen.css);
  assert.ok(screen.markup.startsWith('<div class="screen-s3" style="position:relative;overflow:clip;contain:paint"><div class="top">'), screen.markup);
  assert.equal(screen.style, `<style>${screen.css}</style>`, "the screen's CSS gets its own <style> element");
  assert.equal(readFileSync(join(project, "assets/screens/s3-1.png"), "utf8"), "png");
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
