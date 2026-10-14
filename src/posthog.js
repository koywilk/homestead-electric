// PostHog crash reporting + session replay (SW v529).
//
// Why: a black screen or a lost save in the field was invisible until someone
// complained. PostHog catches every uncaught error and, for a crew member who
// entered their PIN, records what the screen looked like, so Koy can see a
// crash without a phone call.
//
// Boots once from src/index.js, before React renders. With no
// REACT_APP_POSTHOG_KEY (local builds, forks) every export is a no-op, so the
// app never depends on PostHog being up. Observability only: nothing here
// reads or writes Firestore, touches an app localStorage key, or sits on any
// save path, and every PostHog call is wrapped so a failure inside it can
// never reach the app.
import posthog from "posthog-js";

const KEY = process.env.REACT_APP_POSTHOG_KEY || "";
// US cloud unless REACT_APP_POSTHOG_HOST says otherwise (EU: https://eu.i.posthog.com).
const HOST = process.env.REACT_APP_POSTHOG_HOST || "https://us.i.posthog.com";

let booted = false;
let currentName = null;

// Share links, the GC portal and homeowner pages carry their tokens in the
// URL. Those must never leave the device, so every URL-like property is cut
// at its query string before it is sent, and replay's network list likewise.
const stripQuery = (s) => (typeof s === "string" ? s.replace(/[?#].*$/, "") : s);
const sanitize = (props) => {
  if (!props || typeof props !== "object") return props;
  for (const k of Object.keys(props)) {
    const v = props[k];
    if (v && typeof v === "object" && !Array.isArray(v)) sanitize(v);
    else if (typeof v === "string" && /url|referrer|href/i.test(k)) props[k] = stripQuery(v);
  }
  return props;
};

export function bootPostHog() {
  if (booted || !KEY) return;
  booted = true;
  try {
    posthog.init(KEY, {
      api_host: HOST,
      autocapture: false,            // no click stream; errors and replay only
      capture_pageview: true,        // one event per open so a session exists
      capture_pageleave: false,
      capture_exceptions: true,      // window errors + unhandled rejections
      person_profiles: "identified_only",
      disable_session_recording: true, // started per crew member below
      session_recording: {
        maskAllInputs: true,         // PIN pad, every text box
        maskCapturedNetworkRequestFn: (req) => {
          if (req && typeof req.name === "string") req.name = stripQuery(req.name);
          return req;
        },
      },
      sanitize_properties: (props) => sanitize(props),
    });
    // Ties every error to the build it came from (same stamp as Settings).
    posthog.register({ app_version: process.env.REACT_APP_VERSION || "" });
  } catch (e) { /* observability must never break the app */ }
}

// Called from App at render time (idempotent, like _setUsageUser): ties
// errors and replay to the crew member who entered their PIN, by display
// name only. The stored identity also carries role and PIN; none of that is
// sent. Replay runs only while someone is signed in.
export function syncPostHogIdentity(identity) {
  if (!booted) return;
  const name = identity && typeof identity.name === "string" ? identity.name.trim() : "";
  if (name === (currentName || "")) return;
  try {
    if (name) {
      posthog.identify(name, { name });
      posthog.startSessionRecording();
    } else {
      posthog.stopSessionRecording();
      posthog.reset();
    }
    currentName = name || null;
  } catch (e) { /* see above */ }
}
