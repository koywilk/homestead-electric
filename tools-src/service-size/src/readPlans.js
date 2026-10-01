// Turns dropped plan files (PDF or photos) into sheet text + images, then asks /api/read-plans for calculator inputs.
// pdf.js "legacy" build: same 4.10.38 release, compiled for older browsers (older phones on the crew).
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import { ITEMS } from "./calc.js";

// The build copies the worker next to the bundled JS, so this resolves to the tool's own folder
// (e.g. /tools/service-size/pdf.worker.min.mjs). No CDN.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("./pdf.worker.min.mjs", import.meta.url).href;

const MAX_EDGE = 1568; // Claude's recommended long edge; larger images are downsized anyway
const MAX_IMAGES = 8;
const MAX_UPLOAD_CHARS = 3_800_000; // conservative request size; the Miller set was about 1.5 MB

const blobToBase64 = (blob) =>
  new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = fail;
    r.readAsDataURL(blob);
  });

async function canvasToJpeg(canvas) {
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  return { media_type: "image/jpeg", data: await blobToBase64(blob) };
}

function whiteCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  return { c, ctx };
}

async function readPdf(file, maxImages, { onProgress, signal }) {
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    onProgress?.(`Reading sheet ${i} of ${pdf.numPages}…`);
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    pages.push({ n: i, page, text: tc.items.map((t) => t.str).join(" ").replace(/\s+/g, " ").trim() });
  }
  // Floor plans and electrical sheets get images first.
  const score = (t) =>
    (/floor plan|basement|main floor|second floor|upper|lower|level/i.test(t) ? 2 : 0) +
    (/electrical|mechanical|panel|schedule/i.test(t) ? 1 : 0);
  const chosen = [...pages].sort((a, b) => score(b.text) - score(a.text) || a.n - b.n).slice(0, maxImages).sort((a, b) => a.n - b.n);
  const images = [];
  for (const p of chosen) {
    if (signal?.aborted) throw new DOMException("Stopped", "AbortError");
    onProgress?.(`Rendering sheet ${p.n}…`);
    const vp1 = p.page.getViewport({ scale: 1 });
    const vp = p.page.getViewport({ scale: Math.min(MAX_EDGE / Math.max(vp1.width, vp1.height), 3) });
    const { c, ctx } = whiteCanvas(vp.width, vp.height);
    await p.page.render({ canvasContext: ctx, viewport: vp }).promise;
    images.push(await canvasToJpeg(c));
  }
  // General notes repeat on every sheet; keep one copy's worth out of the text.
  const split = (t) => t.split(/(?<=\.)\s+/);
  const seen = new Map();
  pages.forEach((p) => split(p.text).forEach((s) => seen.set(s, (seen.get(s) || 0) + 1)));
  const text = pages
    .map((p) => `=== Sheet ${p.n} ===\n` + split(p.text).filter((s) => seen.get(s) < 3 || s.length < 40).join(" "))
    .join("\n\n");
  return { text, images, labels: chosen.map((p) => String(p.n)) };
}

async function readImage(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const { c, ctx } = whiteCanvas(bmp.width * k, bmp.height * k);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  return canvasToJpeg(c);
}

export const isPlanFile = (f) => /pdf|image\/(jpeg|png|webp)/.test(f.type) || /\.(pdf|jpe?g|png|webp)$/i.test(f.name);

/**
 * Read plan files and ask Claude for calculator inputs.
 * Returns the plan JSON (same shape as MILLER_EXAMPLE). Throws Error with a user-facing message.
 */
export async function readPlans(files, { apiPath = "/api/read-plans", accessKey, onProgress, signal } = {}) {
  files = [...files].filter(isPlanFile);
  if (!files.length) throw new Error("That file type isn't supported. Drop a PDF or a JPG/PNG photo of the plans.");
  let text = "";
  const images = [], labels = [];
  for (const f of files) {
    if (/pdf/.test(f.type) || /\.pdf$/i.test(f.name)) {
      const r = await readPdf(f, Math.max(0, MAX_IMAGES - images.length), { onProgress, signal });
      text += r.text + "\n\n";
      images.push(...r.images);
      labels.push(...r.labels.map((l) => (files.length > 1 ? `${f.name} p${l}` : l)));
    } else if (images.length < MAX_IMAGES) {
      onProgress?.(`Preparing ${f.name}…`);
      images.push(await readImage(f));
      labels.push(f.name);
    }
  }
  text = text.slice(0, 150000);
  // Drop images from the end if the request would be too big.
  while (images.length && images.reduce((n, im) => n + im.data.length, 0) + text.length > MAX_UPLOAD_CHARS) {
    images.pop();
    labels.pop();
  }

  onProgress?.(`Claude is reading ${images.length ? images.length + " sheets" : "the plan text"}. This takes 30 seconds to 2 minutes…`);
  const res = await fetch(apiPath, {
    method: "POST",
    headers: { "content-type": "application/json", ...(accessKey ? { "x-plans-key": accessKey } : {}) },
    body: JSON.stringify({
      fileName: files.map((f) => f.name).join(", "),
      text,
      images,
      imageLabels: labels,
      items: ITEMS.map(({ id, name, va, unit }) => ({ id, name, va, unit: unit || "" })),
    }),
    signal,
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.plan) {
    if (res.status === 413) throw new Error("This plan set is too big to send. Try a PDF with just the floor plans and electrical sheets.");
    throw new Error(out?.error || "Something went wrong reading the plans. Try again.");
  }
  return out.plan;
}
