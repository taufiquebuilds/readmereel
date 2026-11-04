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
  assert.equal(out.html, `<img src="a/b.png"><img src="./c.png"><img src="data:image/png;base64,AAAA"><a href="#s-top">t</a><a>p</a>`);
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
  assert.ok(keep.html.includes('id="s-g"') && keep.html.includes('fill="url(#s-g)"') && keep.html.includes('href="#s-g"'), keep.html);
  const bad = clean(`<svg><rect fill="url(https://x/a.svg#f)"/></svg>`);
  assert.equal(bad.html, "<svg><rect/></svg>");
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
  assert.throws(() => clean(`<style>.a{color:red; .b{background:url(//x/y.png)}}</style>`), /screen: nested CSS rules are not allowed/);
  // a function the browser would read across the "}" is refused rather than emitted unbalanced
  assert.throws(() => clean(`<style>a{b:xurl(} z{c:d)}</style>`), /screen: unsafe CSS/);
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

// ---- security review fixes (task-3-security-findings.md) ----

const VOID_TAGS = new Set(["br", "hr", "img"]);
// Walks the emitted tags with a stack: every end tag must close the current element and nothing may stay open.
function assertBalanced(html, label = html) {
  const stack = [];
  for (const m of html.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [, end, name, self] = m;
    if (end) {
      assert.equal(stack.pop(), name, `unbalanced </${name}> in ${label}: ${html}`);
    } else if (!VOID_TAGS.has(name) && !self) stack.push(name);
  }
  assert.deepEqual(stack, [], `left open in ${label}: ${html}`);
}
const DATA_OK = new Set(["data-pop", "data-was", "data-now"]);
function assertNoForeignData(html, label = html) {
  for (const m of html.matchAll(/\s(data-[A-Za-z0-9_.:-]*)=/g)) assert.ok(DATA_OK.has(m[1]), `${m[1]} kept in ${label}: ${html}`);
}

test("bypass 1: only allowlisted attributes survive, data-* only for the ui hooks", () => {
  const out = clean(`<div data-composition-src="http://x/c.html" data-start="0" data-duration="9" data-var-src="v.json" data-composition-file="c.html" data-field="scenes[0].x" data-zoom-target="1" data-composition-id="s1" attributionsrc="https://x/a" data-pop="1" data-was="a" data-now="b" title="t" aria-label="l" role="note">t</div>`
    + `<div data-composition-src="compositions/evil.html">p</div><svg><use href="#a" xlink:onload="alert(1)"/><rect onload="x" fill="red"/></svg><button type="submit" form="f" formaction="x" name="n" value="v">b</button>`);
  for (const bad of ["data-composition", "data-start", "data-duration", "data-var-src", "data-field", "data-zoom-target", "attributionsrc", "onload", "evil.html", "type=", "form=", "name=", "value="]) {
    assert.ok(!out.html.includes(bad), `still has ${bad}: ${out.html}`);
  }
  assert.ok(out.html.includes('data-pop="1" data-was="a" data-now="b" title="t" aria-label="l" role="note"'), out.html);
  assert.ok(out.html.includes('fill="red"'), out.html);
  assertNoForeignData(out.html);
});

test("bypass 2: nested CSS rules and nesting/scope selectors are rejected", () => {
  assert.throws(() => clean(`<style>.t{ :not(&){color:red} }</style>`), /screen: nested CSS rules are not allowed/);
  assert.throws(() => clean(`<style>.t{color:red; .u{color:blue}}</style>`), /screen: nested CSS rules are not allowed/);
  for (const sel of ["html:has(&)", "& p", ".a &", ":scope", ":scope > p", ":host", ":host(.x) p", ":host-context(body) p", ".a:not(&)"]) {
    assert.throws(() => clean(`<style>${sel}{color:red}</style>`), /screen: selector ".*" reaches outside the screen/, sel);
  }
  assert.ok(!clean(`<div style="color:red;.x{color:blue}">k</div>`).html.includes("style="), "nested rule in a style attribute");
});

test("bypass 3: selectors may not start with a sibling combinator after the scope", () => {
  for (const sel of ["~ p", "+ p", "~*", "body ~ x", "body + x", "html~*", "body.dark ~ x", ":root + *", "body:not(.a)~p", "body.a\\31 b~p", "|| p"]) {
    assert.throws(() => clean(`<style>${sel}{color:red}</style>`), /screen: selector ".*" reaches outside the screen/, sel);
  }
  // shape of every emitted selector: the scope, then a space, ">", ".", ":", "[", "#" or the end, never a sibling first
  const ok = ".a, p > b, body, html body p, body.dark .x, body:hover, body > p, :root, * , ::selection, [x=\"~\"], .a ~ .b, .a + .b, :is(.a, .b) ~ i, body:has(~ .x), #id, body#id p, :not(.a ~ .b)";
  const css = clean(`<style>${ok}{color:red}</style>`).css;
  const prelude = css.slice(0, css.indexOf("{"));
  for (const sel of prelude.split(/,(?![^(]*\))(?![^[]*\])/)) {
    assert.match(sel, /^\.s(?:$|[\s>.:[#])/, sel);
    const rest = sel.slice(2).replace(/\([^)]*\)|\[[^\]]*\]/g, "()");
    assert.doesNotMatch(rest, /^[^\s>~+]*\s*[~+]/, sel);
  }
});

test("bypass 4: output markup is balanced and cannot close or swallow the wrapper", () => {
  const cases = {
    "</div></div><p>x": "<p>x</p>",
    "<div>x": "<div>x</div>",
    "<table><tr><td>x": "<table><tbody><tr><td>x</td></tr></tbody></table>",
    "<svg><g><rect>": "<svg><g><rect></rect></g></svg>",
    "<select><option>x</option></select>y": "y",
    "<b><i>x</b>y</i>": "<b><i>x</i></b>y",
    "<ul><li><div>a<li>b</ul>": "<ul><li><div>a</div></li><li>b</li></ul>",
    "<p>a<div>b</div></p>": "<p>a</p><div>b</div>",
    "<p><span>a<table><tr><td>b</td></tr></table>": "<p><span>a</span></p><table><tbody><tr><td>b</td></tr></tbody></table>",
    "<h1>a<h2>b</h2></h1>": "<h1>a</h1><h2>b</h2>",
    "<a href=\"#x\">a<a>b</a></a>": "<a href=\"#s-x\">ab</a>",
    "<button>a<button>b</button></button>": "<button>ab</button>",
    "<table><div>x</div>junk<tr><td>a</td></tr><td>b</td></table>": "<table><tbody><tr><td>a</td></tr></tbody></table>",
    "<tr><td>loose</td></tr>": "loose",
    "<table><table><tr><td>x</td></tr></table></table>": "<table><tbody><tr><td>x</td></tr></tbody></table>",
    "<svg><div>x</div><title><b>t</b></title></svg>": "<svg>x<title>t</title></svg>",
    "<blink>a</blink><font color=red>b</font><center>c</center>": "abc",
    "<div/>x": "<div>x</div>",
    "<math><mi>x</mi></math><textarea>y</textarea><noscript>z</noscript><template>t</template>ok": "ok",
    "<svg><foreignObject><div>x</div></foreignObject><circle/></svg>": "<svg><circle/></svg>",
    "<path d=\"M0\"/>x": "x",
    "<embed src=a.png><object>o</object><iframe>i</iframe>z": "z",
  };
  for (const [input, want] of Object.entries(cases)) {
    const out = clean(input);
    assert.equal(out.html, want, input);
    assertBalanced(out.html, input);
  }
  // a document wrapped around everything still yields balanced output
  for (const h of ["<html><body><div><span>x</body></html>", "<div><table><tr><td><div>x</div></table>", "<svg><text>a<tspan>b</svg>"]) assertBalanced(clean(h).html, h);
});

test("bypass 5: only image files are collected", () => {
  for (const src of ["a.html", "a.js", "a.png.html", "x.mjs", "page.htm", "a.css", "noext", "a.svgz"]) {
    const out = clean(`<img src="${src}"><div style="background:url(${src})">k</div><style>.a{background:url("${src}")}</style>`);
    assert.deepEqual(out.images, [], src);
    assert.ok(!out.html.includes("<img"), src);
    assert.ok(!out.html.includes(src) && !out.css.includes(src), `${src}: ${out.html} ${out.css}`);
  }
  const keep = clean(`<img src="a.png"><img src="b.JPG"><img src="c.jpeg"><img src="d.gif"><img src="e.webp"><img src="f.svg">`);
  assert.deepEqual(keep.images, ["a.png", "b.JPG", "c.jpeg", "d.gif", "e.webp", "f.svg"]);
});

test("bypass 6: emitted CSS is self-contained or the screen is refused", () => {
  for (const css of [`a{content:"abc}`, `a{content:'x`, `a{width:calc(1px}`, `a{x:[}`, `a{x:)}`, `a{x:]}`, `a{content:"a\\"}`, `a{x:y\\`]) {
    assert.throws(() => clean(`<style>${css}</style>`), /screen: unsafe CSS/, css);
  }
  for (const style of [`content:'x`, `width:calc(1px`, `x:]`, `a:b}`, `content:"a\\"`]) {
    assert.ok(!clean(`<div style="${style.replace(/"/g, "&quot;")}">k</div>`).html.includes("style="), style);
  }
});

test("bypass 7: ids are prefixed, references follow, template class names are removed", () => {
  const out = clean(`<div id="root" class="scene-data clip hero cam hook-line title-x ui-a terminal-b counter-c compare-d list-e end-cta zoom-z screen-s1 Root keep">k</div>`
    + `<a href="#top">t</a><a href="#">h</a><svg><defs><linearGradient id="g"/><clipPath id="c"/><mask id="m"/></defs><rect fill="url(#g)" stroke="url(#g) red" clip-path="url(#c)" mask="url(#m)"/><use href="#g" xlink:href="#g"/></svg>`
    + `<div aria-labelledby="root other" id="bad id">x</div>`
    + `<style>#root{color:red} .k #g{fill:url(#g)} [data-x="#y"]{color:blue}</style><div style="filter:url(#c)">f</div>`);
  assert.ok(out.html.includes('<div id="s-root" class="keep">'), out.html);
  for (const want of ['href="#s-top"', 'href="#"', 'id="s-g"', 'id="s-c"', 'id="s-m"', 'fill="url(#s-g)"', 'stroke="url(#s-g) red"', 'clip-path="url(#s-c)"', 'mask="url(#s-m)"', '<use href="#s-g" xlink:href="#s-g"/>', 'aria-labelledby="s-root s-other"', 'style="filter:url(#s-c)"']) {
    assert.ok(out.html.includes(want), `${want}: ${out.html}`);
  }
  assert.ok(!out.html.includes("bad id"), out.html);
  assert.ok(out.css.includes(".s #s-root{color:red}") && out.css.includes(".s .k #s-g{fill:url(#s-g)}") && out.css.includes('.s [data-x="#y"]'), out.css);
  for (const bad of [/\bclass="[^"]*\b(?:scene-data|clip|hero|cam|hook-|title-|ui-|terminal-|counter-|compare-|list-|end-|zoom-|screen-)/, /id="root"/]) assert.doesNotMatch(out.html, bad);
  // fragments that are not plain ids, and fill urls that leave the document, are dropped
  const odd = clean(`<a href="#a b">x</a><svg><rect fill="url(a.svg#g)" stroke="url('#g')"/><use href="a.svg#g"/></svg><div style="background:url(#a.b)">y</div>`);
  assert.ok(!/href=|fill=|stroke=|a\.svg|#a\.b/.test(odd.html), odd.html);
});

test("bypass 8: position fixed and sticky become absolute; display:contents is dropped", () => {
  const out = clean(`<div style="position:fixed;top:0">a</div><div style="position: STICKY !important">b</div><div style="position:var(--p)">c</div><div style="display:contents">d</div>`
    + `<style>body{position:fixed} .a{position:-webkit-sticky;left:0} .b{position:relative} .c{display:contents} .d{display:var(--x)}</style>`);
  assert.ok(!/fixed|sticky|var\(--p|contents|var\(--x/i.test(out.html + out.css), out.html + out.css);
  assert.ok(out.html.includes('style="position:absolute;top:0"') && out.html.includes('style="position:absolute!important"') && out.html.includes('style="position:absolute"'), out.html);
  assert.ok(out.css.includes(".s{position:absolute}") && out.css.includes(".s .a{position:absolute;left:0}") && out.css.includes(".s .b{position:relative}"), out.css);
});

test("structural: hostile mixes always give balanced markup with only allowlisted data-*", () => {
  const parts = ["<div>", "</div>", "<p>", "</p>", "<li>", "<ul>", "</ul>", "<table>", "<tr>", "<td>", "</td>", "</table>", "<svg>", "<g>", "</svg>", "<rect/>", "<title>",
    "</title>", "<b>", "</b>", "<a href=#x>", "</a>", "<button>", "<h1>", "<h2>", "<select>", "<math>", "x", " ", "<span data-start=1 data-pop=1>", "</span>", "<img src=a.png>", "<br>", "<pre>"];
  let seed = 7;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  for (let n = 0; n < 3000; n++) {
    let h = "";
    for (let k = 0; k < 14; k++) h += parts[rnd(parts.length)];
    const out = clean(h);
    assertBalanced(out.html, h);
    assertNoForeignData(out.html, h);
  }
});

// ---- round 2 ----

test("round 2 A: a screen over 256 KB is refused", () => {
  const msg = { message: "screen: the screen HTML is over 256 KB" };
  assert.throws(() => clean("a".repeat(256 * 1024 + 1)), msg);
  assert.throws(() => clean("\u00e9".repeat(140000)), msg, "counted in UTF-8 bytes");
  assert.throws(() => clean("<div>".repeat(1 << 18)), msg);
  assert.equal(clean("a".repeat(256 * 1024)).html.length, 256 * 1024, "exactly 256 KB is allowed");
});

test("round 2 A: open elements are capped at depth 256, and the dropped tags' end tags go with them", () => {
  const out = clean("<div>".repeat(300) + "x" + "</div>".repeat(300) + "<p>after</p>");
  assert.equal((out.html.match(/<div>/g) ?? []).length, 256);
  assert.ok(out.html.endsWith("x" + "</div>".repeat(256) + "<p>after</p>"), out.html.slice(-80));
  assertBalanced(out.html, "deep divs");
  // The inner <span> is past the cap: its </span> must not close the outer <span> (and with it every <div>).
  const inner = clean("<span>" + "<div>".repeat(255) + "<span>y</span>z" + "</div>".repeat(255) + "w</span>");
  assert.ok(inner.html.includes("y" + "z</div>"), "z stays in the deepest div");
  assert.ok(inner.html.endsWith("</div>w</span>"), inner.html.slice(-40));
  assertBalanced(inner.html, "inner span");
  const svg = clean("<svg>" + "<g>".repeat(400) + "</svg>");
  assert.equal((svg.html.match(/<g>/g) ?? []).length, 255);
  assertBalanced(svg.html, "deep svg");
});

test("round 2 A: ~200 KB adversarial inputs finish quickly", () => {
  const cases = {
    "deep divs": "<div>".repeat(40000) + "x",
    "deep spans then stray end tags": "<span>".repeat(17000) + "</q>".repeat(25000),
    "divs then li": "<div>".repeat(20000) + "<li></li>".repeat(11000),
    "spans then div (p scope)": "<span>".repeat(17000) + "<div></div>".repeat(9000),
    "a then nested a": "<a>" + "<div>".repeat(20000) + "<a>".repeat(30000),
    "deep svg": "<svg>" + "<g>".repeat(66000),
    "class list with a reserved name": '<div class="' + "a ".repeat(100000) + 'hero">x</div>',
    "comments": "<!--a-->".repeat(25000),
    "deep tag soup": "<b><i><p><li><div><table><tr><td>".repeat(6000),
  };
  for (const [label, html] of Object.entries(cases)) {
    assert.ok(Buffer.byteLength(html) < 256 * 1024 && html.length > 150000, label);
    const t = performance.now();
    const out = clean(html);
    const ms = performance.now() - t;
    assert.ok(ms < 1500, `${label} took ${ms.toFixed(0)} ms`);
    assertBalanced(out.html, label);
  }
});

test("round 2 D: links keep only same-document fragments", () => {
  for (const href of ["page.html", "./a.png", "compositions/evil.html", "a/b", "?x=1", "data:image/png;base64,AA"]) {
    const out = clean(`<a href="${href}">k</a>`);
    assert.equal(out.html, "<a>k</a>", href);
  }
  assert.equal(clean('<a href="#top">t</a><a href="#">h</a>').html, '<a href="#s-top">t</a><a href="#">h</a>');
});

// ---- round 3 ----

// What the browser reads: every escape decoded (CSS Syntax 4.3.7), comments gone.
const decodedCss = (s) => s.replace(/\/\*[^]*?\*\//g, "").replace(/\\(?:([0-9a-fA-F]{1,6})[ \t\n\f]?|([^\n]))/g, (m, hex, ch) => (hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : ch));
const LOADERS = /(?:image-set|cross-fade|element|paint|src|image)\s*\(/i;

const IMAGE_SET_SPELLINGS = [
  "image\\2d set", "image\\2D set", "image\\00002d set", "image\\2d\tset", "image\\-set", "-webkit-image\\2d set", "-webkit-image\\-set",
  "IMAGE-SET", "Image-Set", "\\69mage-set", "\\49 MAGE\\2d SET", "\\-webkit-image-set", "-\\77 ebkit-image-set", "image-se\\74",
  "-moz-image-set", "cross\\-fade", "cross\\2d fade", "-webkit-cross-fade", "\\65lement", "-moz-element", "paint", "src", "\\73rc", "image",
];

test("round 3 E: a function name is judged after every CSS escape is decoded (style blocks)", () => {
  for (const name of IMAGE_SET_SPELLINGS) {
    const out = clean(`<style>.a{color:red;background-image:${name}("http://127.0.0.1:9/x.png" 1x);width:1px}</style><div class="a">k</div>`);
    assert.ok(!/http|127\.0/.test(out.css), `${name}: ${out.css}`);
    assert.ok(!LOADERS.test(decodedCss(out.css)), `${name}: ${out.css}`);
    assert.ok(out.css.includes("color:red") && out.css.includes("width:1px"), `${name}: only the bad declaration goes: ${out.css}`);
    assert.ok(out.removed.some((r) => /function|external-load/.test(r)), `${name}: reported: ${out.removed}`);
  }
});

test("round 3 E: the same spellings in style attributes are removed", () => {
  for (const name of IMAGE_SET_SPELLINGS) {
    const out = clean(`<div style='color:red;background-image:${name}("http://127.0.0.1:9/y.png" 1x)'>k</div>`);
    assert.ok(!/http|127\.0/.test(out.html), `${name}: ${out.html}`);
    assert.ok(!LOADERS.test(decodedCss(out.html.replace(/&quot;/g, '"'))), `${name}: ${out.html}`);
    assert.ok(out.html.includes("color:red"), `${name}: ${out.html}`);
  }
});

test("round 3 E: custom properties cannot carry a loader to var(), nested or not", () => {
  for (const css of [
    `.a{--u:image\\2d set("http://h/z.png" 1x);background:var(--u)}`,
    `.a{--u:  -webkit-image\\2d set("http://h/z.png" 1x)}`,
    `.a{--u:linear-gradient(red,blue),image\\-set("http://h/z.png" 1x)}`,
    `.a{background:var(--nope,image\\2d set("http://h/z.png" 1x))}`,
    `.a{background:linear-gradient(red,blue),calc(1px + image\\2d set("http://h/z.png" 1x))}`,
    `.a{background:rgb(0 0 0 / var(--x, \\69mage-set("http://h/z.png" 1x)))}`,
    `.a{--\\75:image\\2d set("http://h/z.png" 1x)}`,
  ]) {
    const out = clean(`<style>${css}</style><div style='${css.slice(3, -1)}' class="a">k</div>`);
    assert.ok(!/http|h\/z/.test(out.css) && !/http|h\/z/.test(out.html), `${css}: ${out.css} ${out.html}`);
  }
});

test("round 3 E: only allowlisted CSS functions survive, and an escaped ( is refused", () => {
  for (const decl of [
    "background:attr(x)", "width:env(safe-area-inset-top)", "left:anchor(--a left)", "background:-webkit-canvas(x)",
    "background:foo(1px)", "width:calc\\(1px)", "width:calc\\28 1px)", "content:counter\\(x)", "background:url\\(x.png)",
    "transform:-webkit-image-set(x)", "background:\\2d webkit-image-set(x)", "background:--x(1)",
  ]) {
    const out = clean(`<style>.a{color:red;${decl}}</style><div style="color:blue;${decl.replace(/"/g, "&quot;")}">k</div>`);
    assert.match(out.css, /^\.s \.a\{color:red;?\}$/, decl);
    assert.match(out.html, /^<div style="color:blue;?">k<\/div>$/, decl);
  }
  const ok = [
    "color:rgb(1 2 3 / 50%)", "color:RGBA(1,2,3,.5)", "color:hsl(1 2% 3%)", "color:oklch(0.7 0.1 200)", "color:color-mix(in srgb,red 50%,blue)",
    "color:color(display-p3 1 0 0)", "width:calc(100% - var(--w,10px))", "width:clamp(1px,2vw,3px)", "width:min(1px,max(2px,3px))",
    "background:linear-gradient(135deg,#1e293b,#0f172a)", "background:-webkit-linear-gradient(top,red,blue)",
    "background:repeating-radial-gradient(circle,red,blue 10%)", "background:conic-gradient(red,blue)",
    "transform:translate(-50%,-50%) rotate(45deg) scaleX(2) skewY(1deg) matrix(1,0,0,1,0,0) translate3d(0,0,0)",
    "transform:perspective(100px) rotateX(10deg)", "transition:all .2s cubic-bezier(.2,0,0,1)", "animation-timing-function:steps(4,end)",
    "filter:blur(2px) brightness(1.1) contrast(1) drop-shadow(0 1px 2px rgb(0 0 0/.3)) grayscale(1) hue-rotate(9deg) invert(0) opacity(1) saturate(2) sepia(0)",
    "grid-template-columns:repeat(auto-fill,minmax(200px,1fr))", "width:fit-content(20em)", 'content:counter(x) ". "',
    'content:"\\2022"', 'content:"\\201C quoted \\201D"', "font-family:\\49nter,system-ui", "background:url(shots/a.png)",
  ];
  const out = clean(`<style>.a{${ok.join(";")}}</style>`);
  for (const decl of ok) {
    const prop = decl.slice(0, decl.indexOf(":"));
    assert.ok(out.css.includes(`${prop}:`), `${decl} kept: ${out.css}`);
  }
  assert.ok(out.css.includes('content:"\\2022"') && out.css.includes('content:"\\201C quoted \\201D"'), out.css);
  assert.ok(!out.removed.some((r) => /function/.test(r)), out.removed.join("; "));
  const attr = clean(`<div style='${ok.slice(0, 6).join(";")}'>k</div>`);
  for (const decl of ok.slice(0, 6)) assert.ok(attr.html.includes(decl.slice(0, decl.indexOf(":") + 1)), `${decl} kept in attr: ${attr.html}`);
});

test("round 3 E: escaped property names are judged decoded", () => {
  for (const prop of ["-moz-\\62 inding", "-moz\\2d binding", "\\62 ehavior", "\\-moz-binding"]) {
    const out = clean(`<style>.a{color:red;${prop}:url(x.xml)}</style>`);
    assert.match(out.css, /^\.s \.a\{color:red;?\}$/, prop);
  }
});

test("round 3 E: escaped selectors and functional pseudo-classes still pass the final scan", () => {
  const css = String.raw`.md\:flex{display:flex} .w-\[calc\(100\%-2rem\)\]{width:calc(100% - 2rem)} li:nth-child(2n+1):not(.x):is(.a,.b):where(p)>a:has(>img){color:rgb(1 2 3)} p::before{content:"\2022"}`;
  const out = clean(`<style>${css}</style><div class="md:flex">x</div>`);
  assert.equal(out.css, String.raw`.s .md\:flex{display:flex} .s .w-\[calc\(100\%-2rem\)\]{width:calc(100% - 2rem)} .s li:nth-child(2n+1):not(.x):is(.a,.b):where(p)>a:has(>img){color:rgb(1 2 3)} .s p::before{content:"\2022"}`);
});
