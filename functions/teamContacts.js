// Team phone list (SW v655, Koy 2026-11-16 / 11-19): "can we add all of our crews emails and phone
// numbers to the app? and in the option to CC somebody on a purchase order etc a drop down with all
// emails there to choose from?" and "everyone needs to be able to have everybody's number".
//
// The numbers already live in Simpro (each employee's Primary Contact), so Simpro stays the one place
// to type them: nothing is copied into Firestore (the database is open to read, so phones and personal
// emails must never sit in it). The teamContacts callable (index.js) reads Simpro's employee list and
// hands this module's merge to anyone signed in with a live PIN, contractors excepted.
//
// Pure functions only, tested by scripts/team-contacts-test.js (prebuild).

const T = (v) => String(v == null ? "" : v).trim();
const nameKey = (v) => T(v).toLowerCase().replace(/\s+/g, " ");
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[A-Za-z]{2,}$/;

function cleanEmail(v) {
  const e = T(v).toLowerCase();
  return EMAIL_RE.test(e) ? e : "";
}

// "(801) 555-1234", "801-555-1234", "8015551234" → "(801) 555-1234"; anything else kept as typed.
function cleanPhone(v) {
  const raw = T(v);
  if (!raw) return "";
  let d = raw.replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  return raw.slice(0, 30);
}

// Digits only, for tel: / sms: links ("" when it isn't a 10-digit US number).
function dialOf(phone) {
  let d = T(phone).replace(/\D/g, "");
  if (d.length === 11 && d[0] === "1") d = d.slice(1);
  return d.length === 10 ? d : "";
}

// simproEmployees: [{ ID, Name, Archived, PrimaryContact: { Email, CellPhone, WorkPhone } }]
// teamUsers: settings/users list ({ id, name, title, access, active }).
// Returns one row per person, sorted by name:
//   { name, teamId, title, email, phone, inSimpro }
// - Archived Simpro employees are left out.
// - Anyone deactivated in the app is left out, even when Simpro still lists them.
// - Contractors in the app are left out (outside the company).
// - Active app people with no Simpro record are kept with no email or phone (inSimpro false), so the
//   office can see who is missing.
// - Simpro people who aren't app users (office staff) are kept, with no teamId.
function buildContacts(simproEmployees, teamUsers) {
  const team = Array.isArray(teamUsers) ? teamUsers.filter(u => u && T(u.name)) : [];
  const byName = new Map();
  for (const u of team) byName.set(nameKey(u.name), u);
  const out = [];
  const seen = new Set();
  for (const e of Array.isArray(simproEmployees) ? simproEmployees : []) {
    if (!e || e.Archived === true || !T(e.Name)) continue;
    const key = nameKey(e.Name);
    if (seen.has(key)) continue;
    const u = byName.get(key);
    if (u && (u.active === false || T(u.access) === "contractor")) { seen.add(key); continue; }
    seen.add(key);
    const pc = e.PrimaryContact || {};
    out.push({
      name: u ? T(u.name) : T(e.Name),
      teamId: u ? T(u.id) : "",
      title: u ? T(u.title) : "",
      email: cleanEmail(pc.Email),
      phone: cleanPhone(pc.CellPhone) || cleanPhone(pc.WorkPhone),
      inSimpro: true,
    });
  }
  for (const u of team) {
    const key = nameKey(u.name);
    if (seen.has(key) || u.active === false || T(u.access) === "contractor") continue;
    seen.add(key);
    out.push({ name: T(u.name), teamId: T(u.id), title: T(u.title), email: "", phone: "", inSimpro: false });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// Who may read the list: any live member except a contractor.
function mayRead(user) {
  return !!(user && user.active !== false && T(user.access) !== "contractor");
}

module.exports = { buildContacts, cleanEmail, cleanPhone, dialOf, mayRead, nameKey };
