// Entry point for the standalone page (public/tools/service-size/index.html).
// Settings come from window.SSC_CONFIG in index.html so they can be changed without a rebuild.
import { createRoot } from "react-dom/client";
import ServiceSizeCalculator from "./ServiceSizeCalculator.jsx";

const cfg = window.SSC_CONFIG || {};

// Save to job is left out of this version (no onSave passed), per the handoff.
createRoot(document.getElementById("root")).render(
  <ServiceSizeCalculator apiPath={cfg.API_PATH || "/api/read-plans"} accessKey={cfg.PLANS_KEY} />
);
