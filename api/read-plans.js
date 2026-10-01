// Vercel serverless function: POST /api/read-plans
// Sends plan sheets (images + extracted text) to Claude and returns the calculator inputs as JSON.
//
// Environment variables (Vercel → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   required. From console.anthropic.com.
//   ANTHROPIC_MODEL     optional. Defaults to claude-sonnet-5-5.
//   PLANS_ACCESS_KEY    required. Requests must send the same value in the x-plans-key header
//                       (the page sends PLANS_KEY from window.SSC_CONFIG in public/tools/service-size/index.html).
//
// CommonJS on purpose: the app's root package.json has no "type": "module". No dependencies (built-in fetch only).
//
// Request body (JSON), built by tools-src/service-size/src/readPlans.js:
//   { fileName, text, images: [{ media_type, data (base64) }], imageLabels: [..], items: [{ id, name, va, unit }] }

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_IMAGES = 8;
const MAX_TEXT = 150000;

function buildPrompt({ fileName, text, imageLabels, items }) {
  const itemList = items
    .map((it) => `- ${it.id}: ${it.name}${it.unit ? ` (qty in ${it.unit})` : ""}, default ${it.va} VA${it.unit ? " per " + it.unit : " each"}`)
    .join("\n");
  return `You are helping a master electrician size the electrical service for a new single-family home at bid stage (NEC 220.82 optional calculation). Read the attached plan set and fill in the calculator inputs.

File: ${fileName}
${imageLabels.length ? `Attached images are sheets ${imageLabels.join(", ")} of the set, in order.` : "No images attached; use the text."}
Below is the text extracted from every sheet (general notes that repeat on each sheet were removed).

Rules:
- Boilerplate code notes (e.g. "gas appliances shall have shut-off", "whirlpool tubs must have anti-scald") are NOT evidence of equipment.
- "yes" only when the item is drawn, labeled, or has a dedicated outlet on the plans. "maybe" when it is not shown but is common for a home like this or the space suggests it. "no" when clearly absent or unlikely.
- living_sqft = habitable floor area for 220.82 (all floors, including finished or finishable basement). Exclude garages, covered porches/decks/patios. If a floor's area is not labeled, estimate it from the drawing and mark estimated:true.
- Fuel: pick gas only if the plans show gas equipment or gas service for it; if a fuel is not stated, use "undecided".
- tier: 0 = standard/spec, 1 = upgraded, 2 = custom/luxury.
- tons: only if a tonnage or equipment schedule is on the plans, else null.
- Keep every string short (under 110 characters).

Calculator item ids:
${itemList}

Reply with only this JSON object, no other text:
{"job":string,"tier":0|1|2,"living_sqft":number,
 "areas":[{"label":string,"sqft":number,"estimated":boolean,"counted":boolean}],
 "small_appliance_circuits":number,"laundry_circuits":number,
 "heat":"gas"|"hp"|"baseboard"|"undecided","cool":"ac"|"none","tons":number|null,
 "range":"gas"|"range"|"cook_wall"|"cook_double"|"undecided","dryer":"gas"|"elec"|"undecided","dryer_qty":number,
 "wh":"gas"|"tank"|"hpwh"|"tankless"|"undecided","wh_qty":number,
 "items":{"<item id>":{"status":"yes"|"maybe"|"no","qty":number,"va":number|null,"note":string}},
 "findings":[{"what":string,"where":"sheet number or name","confidence":"shown"|"implied"|"assumed"}],
 "questions":[string],"not_in_calc":[string]}

Include every item id in "items". List up to 12 findings, the questions an electrician should ask the owner before pricing the service, and any electrical loads seen that the calculator does not cover.

--- SHEET TEXT ---
${text}`;
}

// Tolerant JSON parse: whole reply, else a ``` fence, else first { to last }.
function parseJson(s) {
  try { return JSON.parse(s); } catch {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Use POST." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "The server is missing ANTHROPIC_API_KEY." });
  }
  // The access key is required: with no PLANS_ACCESS_KEY set, the endpoint refuses everything
  // rather than running open.
  if (!process.env.PLANS_ACCESS_KEY) {
    return res.status(500).json({ error: "The server is not configured (PLANS_ACCESS_KEY is missing)." });
  }
  if (req.headers["x-plans-key"] !== process.env.PLANS_ACCESS_KEY) {
    return res.status(401).json({ error: "Not allowed." });
  }

  let body = req.body || {};
  if (typeof body === "string") {
    try { body = JSON.parse(body || "{}"); } catch { return res.status(400).json({ error: "Body must be JSON." }); }
  }
  const images = (Array.isArray(body.images) ? body.images : [])
    .filter((im) => im && typeof im.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(im.media_type))
    .slice(0, MAX_IMAGES);
  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((it) => it && /^[a-z0-9_]{1,24}$/.test(it.id))
    .slice(0, 40)
    .map((it) => ({ id: it.id, name: String(it.name || it.id).slice(0, 60), va: Number(it.va) || 0, unit: it.unit ? String(it.unit).slice(0, 10) : "" }));
  const prompt = buildPrompt({
    fileName: String(body.fileName || "plans").slice(0, 200),
    text: String(body.text || "").slice(0, MAX_TEXT),
    imageLabels: (Array.isArray(body.imageLabels) ? body.imageLabels : []).slice(0, MAX_IMAGES).map(String),
    items,
  });

  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
    { type: "text", text: prompt },
  ];

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content }] }),
    });
  } catch (e) {
    return res.status(502).json({ error: "Couldn't reach Claude. Try again." });
  }

  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = data?.error?.message || `Claude returned ${r.status}.`;
    const status = r.status === 429 || r.status === 529 ? 503 : 502;
    return res.status(status).json({ error: status === 503 ? "Claude is busy right now. Wait a minute and try again." : msg });
  }

  const text = (data?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const plan = parseJson(text);
  if (!plan || typeof plan !== "object") {
    return res.status(502).json({ error: "Claude's answer couldn't be read. Try again." });
  }
  return res.status(200).json({ plan, model: data.model, truncated: data.stop_reason === "max_tokens" });
};
