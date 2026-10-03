// Carry the calculator's state in a link (#s=…&print=customer) so a phone can open the
// finished sheet in a real browser tab and print it there (v502). Inside the app the tool
// runs in a frame, and phone browsers ignore a print request from a frame; the installed
// app has no print dialog at all and does not share the handoff drawer with Safari. The
// link is opened on the same device and carries the same numbers already on screen;
// nothing is sent anywhere. gzip + base64url when the browser has CompressionStream
// (Safari 16.4+, Chrome 80+), plain base64url otherwise. Pure except for the browser APIs.
const b64u = (bytes) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64u = (str) => {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
async function pipe(bytes, Ctor, kind) {
  const stream = new Blob([bytes]).stream().pipeThrough(new Ctor(kind));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
// Synchronous, uncompressed. Always works; used when a compressed copy is not ready yet.
export function encodeStateSync(state) {
  return "j" + b64u(new TextEncoder().encode(JSON.stringify(state)));
}
export async function encodeState(state) {
  const raw = new TextEncoder().encode(JSON.stringify(state));
  if (typeof CompressionStream !== "undefined") {
    try { return "z" + b64u(await pipe(raw, CompressionStream, "gzip")); } catch (e) { /* fall through */ }
  }
  return "j" + b64u(raw);
}
export async function decodeState(str) {
  if (!str || str.length < 2) return null;
  try {
    const kind = str[0], bytes = unb64u(str.slice(1));
    const raw = kind === "z" ? await pipe(bytes, DecompressionStream, "gzip") : bytes;
    const obj = JSON.parse(new TextDecoder().decode(raw));
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
  } catch (e) { return null; }
}
export function parsePrintHash(hash) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
  const print = params.get("print") || "";
  return { s: params.get("s") || "", print: print === "office" ? "office" : print ? "customer" : "" };
}
export function buildPrintUrl(pathname, encoded, mode) {
  return `${pathname}#s=${encoded}&print=${mode === "office" ? "office" : "customer"}`;
}
