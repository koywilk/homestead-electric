# Service Size Calculator (Tools tab)

Source for `public/tools/service-size/`, a standalone page loaded in the Tools tab iframe. It runs the NEC 220.82 optional calculation for single-family dwellings, with Yes/Maybe/No allowances, a bid note, and plan reading: drop a plan set and Claude fills in the form through `api/read-plans.js`.

## Rebuild

```
cd tools-src/service-size
npm install
npm run build     # writes ../../public/tools/service-size/
npm test          # math + old-record checks, plain Node
```

Commit the built output. The app's deploy doesn't run this build, and the app's root `package.json` never sees React, pdf.js or esbuild from here.

## Files

```
src/main.jsx                    entry point; reads window.SSC_CONFIG from index.html
src/index.html                  copied as-is into the build (holds the config block)
src/ServiceSizeCalculator.jsx   the UI
src/ServiceSizeCalculator.css   styles, scoped under .ssc
src/calc.js                     NEC 220.82 math and sizing. Pure functions.
src/readPlans.js                reads PDFs/photos with pdf.js, calls /api/read-plans
src/millerExample.js            plan-reader output for the Miller Residence set (tests and demos)
test/calc.test.mjs              npm test
build.mjs                       esbuild: bundles into the public folder, copies the pdf.js worker
```

## Config (no rebuild needed)

In `public/tools/service-size/index.html`:

```js
window.SSC_CONFIG = {
  PLANS_KEY: "__SET_BY_KOY__",   // must equal PLANS_ACCESS_KEY in Vercel
  API_PATH: "/api/read-plans",
};
```

Set the same value in both `src/index.html` and the built `index.html`, or the next build will put the placeholder back.

## Server (`api/read-plans.js`)

Environment variables in Vercel:

- `ANTHROPIC_API_KEY`: required.
- `PLANS_ACCESS_KEY`: required. If it's missing the function returns 500; if a request has a missing or wrong `x-plans-key` header, it returns 401.
- `ANTHROPIC_MODEL`: optional, defaults to `claude-sonnet-5-5`.

The key is visible in the page source. The spend limit on the Anthropic account is the real cap.

## Notes

- pdf.js is pinned to 4.10.38 and uses its **legacy** build, which is compiled for older browsers. The worker is served from this folder (`./pdf.worker.min.mjs`); there's no CDN.
- pdf.js loads only when someone drops a file, so the calculator opens fast and works offline once the service worker has cached it. Plan reading needs a connection.
- To add an appliance, add it to `ITEMS` in `calc.js`. Saved or old states are run through `normalizeState()`, so new ids don't break them. The item list is sent with each request, so the prompt picks up new items automatically.
- The page serves from `/tools/service-size/` with the trailing slash, since its asset paths are relative.
- Save to job is not in this version. The `onSave` code is still in the component; `main.jsx` doesn't pass it.
