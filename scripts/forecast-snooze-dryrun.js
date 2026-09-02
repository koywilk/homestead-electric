#!/usr/bin/env node
/* READ-ONLY pure-logic dry-run for the Forecast snooze/dismiss helpers.
 * parseAnyDate + the three helpers are copied VERBATIM from src/App.js.
 * No Firestore, writes nothing. Run: node scripts/forecast-snooze-dryrun.js */

// ── verbatim from src/App.js (parseAnyDate) ──
const parseAnyDate = (str) => {
  if(!str) return null;
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(ymd) return new Date(+ymd[1], +ymd[2]-1, +ymd[3]);
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if(mdy) { let [,m,d,y] = mdy; if(y.length===2) y = "20"+y; return new Date(+y, +m-1, +d); }
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

// ── verbatim from src/App.js (the helpers Task 1 adds) ──
const forecastEventSuffix = (ev) => ev.id.slice(ev.job.id.length + 1);
const isForecastSnoozed = (job, suffix, todayMidnight) => {
  const sd = job?.forecastSnooze?.[suffix];
  if (!sd) return false;
  const d = parseAnyDate(sd);
  if (!d) return false;
  const c = new Date(d); c.setHours(0, 0, 0, 0);
  return c > todayMidnight;
};
const forecastSnoozePatch = (job, suffix, isoDate) => ({
  forecastSnooze: { ...(job.forecastSnooze || {}), [suffix]: isoDate },
});

// ── assertions ──
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("FAIL:", msg); fails++; } else console.log("ok:", msg); };
const today = new Date(); today.setHours(0,0,0,0);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const plusDays = (n) => { const d = new Date(today); d.setDate(today.getDate()+n); return d; };

ok(forecastEventSuffix({id:"job1_rough", job:{id:"job1"}}) === "rough", "suffix: rough");
ok(forecastEventSuffix({id:"job1_finish", job:{id:"job1"}}) === "finish", "suffix: finish");
ok(forecastEventSuffix({id:"job1_rt_abc9", job:{id:"job1"}}) === "rt_abc9", "suffix: rt_<id>");
ok(forecastEventSuffix({id:"job1_co_77", job:{id:"job1"}}) === "co_77", "suffix: co_<id>");

ok(isForecastSnoozed({forecastSnooze:{rough:iso(plusDays(3))}}, "rough", today) === true,  "future snooze hides");
ok(isForecastSnoozed({forecastSnooze:{rough:iso(plusDays(-3))}}, "rough", today) === false, "past snooze shows again");
ok(isForecastSnoozed({forecastSnooze:{rough:iso(today)}}, "rough", today) === false, "today snooze shows (not > today)");
ok(isForecastSnoozed({}, "rough", today) === false, "no map -> not snoozed");
ok(isForecastSnoozed({forecastSnooze:{qc:iso(plusDays(3))}}, "rough", today) === false, "different key -> not snoozed");
ok(isForecastSnoozed({forecastSnooze:{rough:"garbage"}}, "rough", today) === false, "unparseable date -> not snoozed (never hide by accident)");

const merged = forecastSnoozePatch({forecastSnooze:{qc:iso(plusDays(3))}}, "rough", iso(plusDays(7))).forecastSnooze;
ok(merged.qc && merged.rough, "patch preserves existing keys while adding one");
ok(Object.keys(forecastSnoozePatch({}, "rough", iso(today)).forecastSnooze).length === 1, "patch works from empty");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
