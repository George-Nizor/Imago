import assert from "node:assert/strict";
import { test } from "node:test";
import { validateDesign } from "../server/validate.mjs";

const fonts = ["Anton", "Inter", "Bebas Neue"];
const opts = { width: 1280, height: 720, fonts };
const page = ({ head = "", style = "", body = "<h1>Hi</h1>", bodyStyle = "width:1280px;height:720px;margin:0;overflow:hidden" } = {}) =>
  `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fonts/fonts.css">${head}<style>body{${bodyStyle}}${style}</style></head><body>${body}</body></html>`;
const check = (html, o = opts) => validateDesign(html, o);

test("a good design has no errors and no warnings", () => {
  const html = page({
    style: 'h1{font-family:"Anton",sans-serif;background:url(assets/bg.png);filter:drop-shadow(0 0 4px #000)} .a{background:url("data:image/png;base64,AAAA")}',
    body: '<h1>Hi</h1><img src="assets/face.png"><svg><use href="#x"/><rect fill="url(#g)"/></svg>',
  });
  assert.deepEqual(check(html), { errors: [], warnings: [] });
});

test("html/body split rules, shorthand font and * reset are understood", () => {
  const html = `<!doctype html><html><head><style>*{margin:0} html,body{overflow:hidden} body{width:1280px;height:720px;font:700 40px/1.1 "Inter", sans-serif}</style></head><body></body></html>`;
  assert.deepEqual(check(html), { errors: [], warnings: [] });
  const inline = `<html><body style="width:1280px;height:720px;margin:0;overflow:hidden"></body></html>`;
  assert.deepEqual(check(inline).errors, []);
});

test("body geometry errors say what is wrong", () => {
  assert.match(check(page({ bodyStyle: "width:1000px;height:720px;margin:0;overflow:hidden" })).errors.join(), /width is 1000px but must be exactly 1280px/);
  assert.match(check(page({ bodyStyle: "height:720px;margin:0;overflow:hidden" })).errors.join(), /width/);
  assert.match(check(page({ bodyStyle: "width:1280px;height:720px;overflow:hidden" })).errors.join(), /margin: 0/);
  assert.match(check(page({ bodyStyle: "width:1280px;height:720px;margin:0" })).errors.join(), /overflow: hidden/);
  assert.match(check("<p>hello</p>").errors.join(), /complete document/);
  assert.match(check("   ").errors.join(), /empty/);
});

test("scripts, handlers, embeds and bad links are errors", () => {
  const cases = {
    "<script>alert(1)</script>": /<script>/,
    '<svg><script>1</script></svg>': /<script>/,
    '<p onclick="x()">a</p>': /onclick/,
    '<img src="x" onerror=alert(1)>': /onerror/,
    '<iframe src="assets/a.html"></iframe>': /<iframe>/,
    '<object data="assets/a"></object>': /<object>/,
    '<embed src="assets/a">': /<embed>/,
    '<a href="javascript:alert(1)">x</a>': /javascript:/,
    '<img src="https://example.com/a.png">': /absolute/,
    '<img src="//example.com/a.png">': /absolute/,
    '<img src="/etc/passwd">': /root-relative/,
    '<img src="../secret.png">': /\.\./,
    '<img srcset="assets/a.png 1x, http://x.test/b.png 2x">': /srcset/,
    '<div style="background:url(http://x.test/a.png)"></div>': /url\(/,
    '<meta http-equiv="refresh" content="0;url=assets/x">': /refresh/,
    '<link rel="stylesheet" href="assets/other.css">': /<link>/,
    '<link rel="icon" href="/fonts/fonts.css">': /<link>/,
    "<base href='/'>": /<base>/,
  };
  for (const [body, pattern] of Object.entries(cases)) {
    const { errors } = check(page({ body }));
    assert.ok(errors.some((e) => pattern.test(e)), `${body} -> ${JSON.stringify(errors)}`);
  }
  assert.ok(check(page({ style: '@import url("https://x.test/a.css");' })).errors.some((e) => /@import/.test(e)));
  assert.ok(check(page({ style: "div{background:url('//x.test/a.png')}" })).errors.some((e) => /url\(/.test(e)));
});

test("comments do not count as markup", () => {
  assert.deepEqual(check(page({ body: "<!-- <script>no</script> --><p>ok</p>" })).errors, []);
});

test("unknown font families only warn", () => {
  const { errors, warnings } = check(page({ style: 'h1{font-family:"Comic Sans MS",Anton,serif} p{font:12px Papyrus,sans-serif}' }));
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => w.includes("Comic Sans MS")));
  assert.ok(warnings.some((w) => w.includes("Papyrus")));
  assert.ok(!warnings.some((w) => w.includes("Anton")));
});

test("using content fonts without the sheet warns", () => {
  const html = `<!doctype html><html><head><style>body{width:1280px;height:720px;margin:0;overflow:hidden;font-family:Anton}</style></head><body></body></html>`;
  const { errors, warnings } = check(html);
  assert.deepEqual(errors, []);
  assert.ok(warnings.some((w) => /fonts\.css/.test(w)));
});

test("tag-name tricks and slash-separated attributes are caught", () => {
  const cases = {
    "<script/x>alert(1)</script>": /<script>/,
    "<script\n>1</script>": /<script>/,
    "< script>1</ script>": /<script>/,
    "<SCRIPT/src=//x.test/a.js></SCRIPT>": /<script>/,
    "<iframe/src=x>": /<iframe>/,
    "<object/data=x>": /<object>/,
    "<embed/src=x>": /<embed>/,
    "<base/href=//x.test/>": /<base>/,
    "<frameset/><frame/src=x>": /<frame/,
    "<applet/code=x>": /<applet>/,
    "<img/src=x/onerror=alert(1)>": /on[a-z]+/,
    "<svg/onload=alert(1)>": /onload/,
    '<img src="a.png"/onerror=alert(1)>': /onerror/,
    '<div\nonclick\n=\n"x()">': /onclick/,
    "<link/rel=stylesheet/href=//x.test/a.css>": /<link>/,
    '<link href="/fonts/fonts.css">': /<link>/,
    '<meta/http-equiv=refresh content="0;url=x">': /http-equiv/,
    "<!--><script>1</script><!-- -->": /<script>/,
  };
  for (const [body, pattern] of Object.entries(cases)) {
    const { errors } = check(page({ body }));
    assert.ok(errors.some((e) => pattern.test(e)), `${body} -> ${JSON.stringify(errors)}`);
  }
});

test("harmless look-alikes are not errors", () => {
  const body = '<p title="one on one">once upon a time</p><a href="#x">link</a><svg><text>onion</text></svg><!-- <script>x</script> --><meta charset="utf-8">';
  assert.deepEqual(check(page({ body })).errors, []);
  assert.deepEqual(check(page({ head: '<link rel="stylesheet" href="/fonts/fonts.css">' })).errors, []);
});
