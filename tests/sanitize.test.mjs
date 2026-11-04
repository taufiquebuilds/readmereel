import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeScreen, scopeCss } from "../skills/readmereel/scripts/lib/sanitize.mjs";

const evil = `<html><head><meta http-equiv="refresh" content="0;url=https://x"><link rel="stylesheet" href="https://x/a.css"><base href="https://x/">
<style>body{background:url(https://x/t.png)} .a,.b > i{color:red} :root{--c:1px}</style></head>
<body onload="alert(1)"><script>alert(1)</script><iframe src="https://x"></iframe><object data="x"></object><embed src="x">
<form action="https://x"><input></form><a href="javascript:alert(1)" onclick="x()">a</a><img src="https://x/p.png"><img src="shots/ok.png" onerror="x()">
<div style="background-image:url('//x/p.png')">ok</div><svg><script>alert(1)</script><a xlink:href="javascript:x"></a></svg></body></html>`;

test("removes active content and outside URLs", () => {
  const out = sanitizeScreen(evil, "screen-s3");
  for (const bad of ["<script", "<iframe", "<object", "<embed", "<form", "<link", "<meta", "<base", "onload", "onclick", "onerror", "javascript:", "https://", "//x/"]) {
    assert.ok(!out.html.includes(bad) && !out.css.includes(bad), `still has ${bad}`);
  }
  assert.ok(out.html.includes(">ok<"));
  assert.deepEqual(out.images, ["shots/ok.png"]);
  assert.ok(out.removed.length >= 10);
});

test("scopes every selector to the screen", () => {
  assert.equal(scopeCss(".a,.b > i{color:red}", "screen-s3"), ".screen-s3 .a,.screen-s3 .b > i{color:red}");
  assert.equal(scopeCss("body{margin:0} html{x:1} :root{--c:1px}", "screen-s3"), ".screen-s3{margin:0} .screen-s3{x:1} .screen-s3{--c:1px}");
});

test("rejects at-rules the screen may not use", () => {
  assert.throws(() => sanitizeScreen("<style>@media (max-width:1px){a{b:c}}</style>", "s"), /screen: @media is not allowed/);
  assert.throws(() => sanitizeScreen("<style>@import url(x.css);</style>", "s"), /screen: @import is not allowed/);
});

// ---- extra hostile input ----

const clean = (html) => sanitizeScreen(html, "s");
// Things that must never survive in the markup or the CSS.
const ACTIVE = /<\s*(script|iframe|object|embed|form|link|meta|base|style|template|noscript|animate|set)\b|\son[a-z]+\s*=|javascript:|vbscript:|https?:|\/\/[a-z]/i;
function assertInert(html, label = html) {
  const out = clean(html);
  assert.ok(!ACTIVE.test(out.html), `html not inert for ${label}: ${out.html}`);
  assert.ok(!ACTIVE.test(out.css), `css not inert for ${label}: ${out.css}`);
  return out;
}

test("tags are matched case-insensitively and with odd separators", () => {
  for (const h of [
    "<ScRiPt>alert(1)</sCrIpT>x",
    "<script/xss>alert(1)</script>x",
    "<script\n>alert(1)</script\n>x",
    "<script>alert(1)",
    "<IFRAME SRC=//x></IFRAME>x",
    "<scr<script>ipt>alert(1)</scr</script>ipt>x",
    "<img src=x onerror=alert(1)>x",
    "<img src=x onerror = alert(1)>x",
    "<img/src=x/onerror=alert(1)>x",
    "<body onload=alert(1)>x",
    "<div ONCLICK='alert(1)' onMouseOver=\"alert(1)\">x</div>",
  ]) assertInert(h);
});

test("unclosed tags and quotes drop the rest instead of leaking", () => {
  assert.ok(!clean('x<img src="a.png" onerror="alert(1)"').html.includes("onerror"));
  assert.ok(!clean("x<a href=\"javascript:alert(1)").html.includes("javascript"));
  assert.ok(!clean("x<script").html.includes("script"));
  assert.equal(clean("1 < 2 and 3<4").html, "1 &lt; 2 and 3&lt;4");
});

test("comments cannot hide or smuggle tags", () => {
  assert.equal(clean("a<!-- <b>hidden</b> -->c").html, "ac");
  assertInert("<!--><script>alert(1)</script>x");
  assertInert("<!--x--!><script>alert(1)</script>x");
  assertInert("<!--[if IE]><script>alert(1)</script><![endif]-->x");
  assertInert("x<!-- <script>alert(1)</script>");
  assertInert("<![CDATA[<script>alert(1)</script>]]>x");
  assertInert("<?xml x?><!DOCTYPE html><div>x</div>");
});

test("attribute values are decoded before URLs are judged", () => {
  for (const url of [
    "javascript&#58;alert(1)",
    "javascript&colon;alert(1)",
    "java&#10;script:alert(1)",
    "java&Tab;script:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "&#106;avascript:alert(1)",
    "  JaVaScRiPt:alert(1)",
    "java\nscript:alert(1)",
    "\u0001javascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "\\\\x/y",
    "/\\x/y",
    "HTTPS://x/y",
    "//x/y",
  ]) {
    const out = assertInert(`<a href="${url}">k</a><img src="${url}">`, url);
    assert.ok(!/href=|src=/.test(out.html), `kept ${url}: ${out.html}`);
  }
});

test("only relative or local-image URLs survive", () => {
  const out = clean(`<img src="a/b.png"><img src="./c.png"><img src="data:image/png;base64,AAAA"><a href="#top">t</a><a href="page.html">p</a>`);
  assert.equal(out.html, `<img src="a/b.png"><img src="./c.png"><img src="data:image/png;base64,AAAA"><a href="#top">t</a><a href="page.html">p</a>`);
  assert.deepEqual(out.images, ["a/b.png", "./c.png"]);
});

test("images with escaping or odd paths are dropped", () => {
  for (const src of ["../a.png", "a/../../b.png", "a/%2e%2e/b.png", "/etc/a.png", "C:\\a.png", "a\\b.png", "a.png?x=1", "a%zz.png"]) {
    const out = clean(`<img src="${src}">`);
    assert.equal(out.html, "", `kept ${src}`);
    assert.deepEqual(out.images, []);
  }
  assert.equal(clean("<img>").html, "");
});

test("srcset and other URL-carrying attributes are dropped", () => {
  const out = clean(`<img src="a.png" srcset="https://x/1.png 1x, //y/2.png 2x"><video poster="a.png" src="a.mp4"></video><div background="a.png" ping="https://x" data="x"></div><button formaction="https://x">b</button><iframe srcdoc="<script>1</script>"></iframe>`);
  assert.ok(!/srcset|poster|background=|ping|formaction|srcdoc|<video/.test(out.html), out.html);
  assert.ok(out.html.includes('<img src="a.png">'));
});

test("svg: scripts, animation of href, foreign content and external references", () => {
  for (const h of [
    `<svg><a href="javascript:alert(1)"><text>x</text></a></svg>`,
    `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`,
    `<svg><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="href" to="javascript:alert(1)"/></svg>`,
    `<svg><use href="https://x/y.svg#a"/><use xlink:href="//x/y.svg#a"/></svg>`,
    `<svg onload=alert(1)></svg>`,
    `<svg><image href="https://x/a.png"/></svg>`,
    `<svg><foreignObject><iframe src="//x"></iframe></foreignObject></svg>`,
    `<svg><style>@import url(https://x/a.css)</style></svg>`.replace("@import url(https://x/a.css)", "a{fill:url(https://x/a.svg#f)}"),
    `<math><maction actiontype="statusline#" xlink:href="javascript:alert(1)">x</maction></math>`,
  ]) assertInert(h);
  const keep = clean(`<svg viewBox="0 0 4 4"><defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs><rect fill="url(#g)" width="4" height="4"/><use href="#g"/></svg>`);
  assert.ok(keep.html.includes('viewBox="0 0 4 4"') && keep.html.includes("linearGradient"), keep.html);
  assert.ok(keep.html.includes('fill="url(#g)"') && keep.html.includes('href="#g"'), keep.html);
  const bad = clean(`<svg><rect fill="url(https://x/a.svg#f)"/></svg>`);
  assert.ok(bad.html.includes('fill="none"'), bad.html);
});

test("self-closing svg shapes stay self-closing so siblings are not swallowed", () => {
  assert.equal(clean('<svg><rect width="1"/><circle/></svg>').html, '<svg><rect width="1"/><circle/></svg>');
  assert.equal(clean("<br/><img src=a.png />").html, '<br/><img src="a.png"/>');
});

test("raw-text and embedding elements are removed with their content", () => {
  for (const h of ["textarea", "title", "xmp", "noembed", "noframes", "noscript", "template", "applet", "video", "audio"]) {
    const out = clean(`<${h}><img src=x onerror=alert(1)>inner</${h}>after`);
    assert.equal(out.html, "after", h);
  }
  assert.equal(clean("a<plaintext><b>x</b>").html, "a");
  assert.equal(clean("<template><template>deep</template>mid</template>end").html, "end");
});

test("output attributes are re-escaped so entities cannot reopen markup", () => {
  const out = clean(`<div title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;" data-x='"><img src=x onerror=1>'>t</div>`);
  assert.ok(!/<script|<img/.test(out.html), out.html);
  assert.ok(out.html.includes("&lt;script&gt;"), out.html);
  // a decoded value that merely looks like a tag stays text
  assert.equal(clean("<p>&lt;script&gt;x&lt;/script&gt;</p>").html, "<p>&lt;script&gt;x&lt;/script&gt;</p>");
});

test("inline styles: url(), spacing, escapes, expression()", () => {
  for (const style of [
    "background:url( 'https://x' )",
    "background:URL(//x/y.png)",
    "background:url(\"javascript:alert(1)\")",
    "background:url(data:text/html;base64,PHNjcmlwdD4=)",
    "background:u\\72l(https://x/y.png)",
    "background:url(\\68ttps://x/y.png)",
    "background:\\75rl(//x)",
    "background:url(/**/https://x/y.png)",
    "background-image:image-set('https://x/a.png' 1x)",
    "background-image:-webkit-image-set(url(//x/a.png) 1x)",
    "width:expression(alert(1))",
    "width:e\\78pression(alert(1))",
    "behavior:url(x.htc)",
    "-moz-binding:url(x.xml#b)",
    "list-style:url(http://x/a.png)",
    "cursor:url(//x/c.cur),auto",
    "content:\"a\nb\"; background:url(//x/y)",
  ]) {
    const out = assertInert(`<div style="${style}">k</div>`, style);
    assert.ok(out.html.includes(">k<"));
    assert.ok(!/x\/y|x\/a|x\/c|\/\/x|htc|xml#b|binding|expression/i.test(out.html), `${style} -> ${out.html}`);
  }
  const keep = clean(`<div style="color:red;background:url(shots/bg.png) no-repeat;width:10px">k</div>`);
  assert.ok(keep.html.includes("color:red") && keep.html.includes("width:10px"), keep.html);
  assert.ok(keep.html.includes('url(&quot;shots/bg.png&quot;)'), keep.html);
  assert.deepEqual(keep.images, ["shots/bg.png"]);
});

test("style blocks: comments, escapes, strings and more at-rules", () => {
  const out = clean(`<style>/* url(https://x) */ .a{color:red/*;background:url(//x)*/} .b{content:"url(//x)";background:url( "//x/y.png" )} .c{background:u\\72l(//x)}</style><i class="a">k</i>`);
  assert.ok(!/\/\/x/.test(out.css.replace(/content:"url\(\/\/x\)"/, "")), out.css);
  assert.ok(out.css.includes(".s .a{color:red}"), out.css);
  assert.ok(out.css.includes('content:"url(//x)"'), out.css);
  for (const css of [
    "@media print{a{b:c}}",
    "@-webkit-keyframes x{from{a:b}}",
    "@KEYFRAMES x{from{a:b}}",
    "@font-face{font-family:x;src:url(//x/a.woff)}",
    "@\\69mport 'x.css';",
    "@supports (display:grid){a{b:c}}",
    "@layer x{a{b:c}}",
    "a{b:c} /* x */ @import url(//x);",
    "a{b:url(@x)} @import url(//x);",
    "a{b:c;@media print{d:e}}",
  ]) {
    assert.throws(() => clean(`<style>${css}</style>`), /^Error: screen: @[^ ]+ is not allowed$/, css);
  }
  // an unterminated string ends at the newline, so what follows is still checked
  assert.throws(() => clean(`<style>a{content:"x\n} @import url(//x);}</style>`), /@import/);
});

test("style blocks: junk, nesting and stray braces do not leak", () => {
  assertInert(`<style>}}{{ a{b:c} ;; {x:1} d</style>`);
  const nested = clean(`<style>.a{color:red; .b{background:url(//x/y.png)}}</style>`);
  assert.ok(!nested.css.includes("//x"), nested.css);
  assert.ok(nested.css.startsWith(".s .a{"), nested.css);
  assertInert(`<style>a{b:xurl(} z{c:d)}</style>`);
});

test("scopeCss handles comma lists, functions, strings and root-like selectors", () => {
  const s = (css) => scopeCss(css, "s");
  assert.equal(s(":is(.a,.b) > i, [data-x=\"a,b\"]{c:d}"), ".s :is(.a,.b) > i,.s [data-x=\"a,b\"]{c:d}");
  assert.equal(s("html body .x{c:d}"), ".s .x{c:d}");
  assert.equal(s("html > body > p{c:d}"), ".s > p{c:d}");
  assert.equal(s("body.dark .x{c:d}"), ".s.dark .x{c:d}");
  assert.equal(s("BODY{c:d}"), ".s{c:d}");
  assert.equal(s("*{c:d} ::selection{c:d}"), ".s *{c:d} .s ::selection{c:d}");
  assert.equal(s("a{c:d}\n/* x */ b{c:d}"), ".s a{c:d} .s b{c:d}");
  assert.equal(s(".x\\:y{c:d}"), ".s .x\\:y{c:d}");
  assert.equal(s("bodyguard{c:d}"), ".s bodyguard{c:d}");
  assert.equal(s("a{c:d} junk"), ".s a{c:d}");
  assert.throws(() => s("@media x{a{b:c}}"), /screen: @media is not allowed/);
});

test("body is taken from a full document and the scope class is checked", () => {
  assert.equal(clean("<!DOCTYPE html><html><head><title>t</title></head><body class=x><p>hi</p></body></html><p>after</p>").html, "<p>hi</p>");
  assert.equal(clean("<p>fragment</p>").html, "<p>fragment</p>");
  assert.throws(() => sanitizeScreen("<p>x</p>", "a b"), /screen: invalid scope class/);
  assert.throws(() => sanitizeScreen("<p>x</p>", ".a{}"), /screen: invalid scope class/);
});

test("every removal is reported in plain words", () => {
  const out = clean(`<script>1</script><a href="javascript:1" onclick="1">x</a><div style="background:url(//x)"></div>`);
  assert.ok(out.removed.length >= 4);
  assert.ok(out.removed.every((r) => typeof r === "string" && r.length > 3));
});
