// Builds the standalone page into ../../public/tools/service-size/  (run: npm run build)
import * as esbuild from "esbuild";
import { rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "../../public/tools/service-size");

// Start clean so old hashed chunks don't pile up.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await esbuild.build({
  entryPoints: { app: path.join(here, "src/main.jsx") },
  outdir: out,
  bundle: true,
  format: "esm",
  splitting: true, // pdf.js loads only when someone drops a file
  chunkNames: "chunk-[hash]",
  minify: true,
  target: ["safari15", "chrome100", "firefox100"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "info",
});

copyFileSync(path.join(here, "src/index.html"), path.join(out, "index.html"));
copyFileSync(path.join(here, "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs"), path.join(out, "pdf.worker.min.mjs"));

console.log("\nBuilt:", readdirSync(out).join(", "));
