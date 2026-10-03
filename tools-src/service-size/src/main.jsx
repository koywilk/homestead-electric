// Entry point for the standalone page (public/tools/service-size/index.html).
// Settings come from window.SSC_CONFIG in index.html so they can be changed without a rebuild.
// A print link (#s=…&print=customer, v502) carries a state from the app's frame or the
// installed app to a real browser tab, where the phone can print it.
import { createRoot } from "react-dom/client";
import ServiceSizeCalculator from "./ServiceSizeCalculator.jsx";
import { decodeState, parsePrintHash } from "./share.js";

const cfg = window.SSC_CONFIG || {};
const root = createRoot(document.getElementById("root"));

(async () => {
  const { s, print } = parsePrintHash(window.location.hash);
  const fromLink = s ? await decodeState(s) : null;
  // Save to job is left out of this version (no onSave passed), per the handoff.
  root.render(
    <ServiceSizeCalculator apiPath={cfg.API_PATH || "/api/read-plans"} accessKey={cfg.PLANS_KEY}
      initialState={fromLink || undefined} openedForPrint={fromLink ? (print || "customer") : ""} />
  );
})();
