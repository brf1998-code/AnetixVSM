// What a company is, read at the moment it matters, never a flag fixed on the day the company was made (2026-09-29).
//
// Brendan: "some of the older companies are not updated to the new designs like sample data. They should all be the
// same and when a system wide update goes it standardizes everything." They were not: sample data, the "Make it live"
// wording, the board link on a tool's pages and diagrams-on-request all read companies.demo, a column set once at
// creation. Only companies made on anetix.ai after the demo workflow (2026-09-25) carry it, so a company added by hand on
// /admin (the Demo Company among them) and the few made on anetix.ai before that never got those features.
//
// One distinction now decides the features: a PAID SITE (Stripe switched it on, platform.sites.stage 'subscribed', or an
// admin switched it on by hand with the payment to follow, platform.sites.switched_on, 2026-10-13) or not. A paid site has a real floor, so nothing made up goes into its tables and its words are the floor's. Every other
// company is a trial and gets every trial feature, however and whenever it was made. companies.demo keeps its narrower
// job: a company that came in from anetix.ai with credit and one manager account (the credit line, Go live, the DEMO
// strip, Settings without the floor's cards, the refund of a stopped build).
//
// standardize() runs at every boot, after every module's own init, so a platform update reaches the companies that
// already exist, not only the ones made after it: whatever the platform keeps per company is brought to the rule.
const { q, logEvent } = require("./db");

const SITE_STAGES = ["subscribed"];
const memo = new Map();   // slug -> { site, at }: a tool page asks on every load
const MEMO_MS = 15000;

async function isSite(company) {
  const hit = memo.get(company);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.site;
  let site = false;
  try { const r = (await q("SELECT stage, switched_on FROM platform.sites WHERE company=$1", [company])).rows[0] || {}; site = SITE_STAGES.includes(r.stage) || Boolean(r.switched_on); }
  catch (e) { return false; }   // no sites table yet (a first boot): nothing is a paid site
  if (memo.size > 2000) memo.clear();
  memo.set(company, { site, at: Date.now() });
  return site;
}
async function isTrial(company) { return !(await isSite(company)); }
function forget(company) { if (company) memo.delete(company); else memo.clear(); }   // activation, back to demo, delete

// Bring every existing company to the rule. -> { demos: [slugs made demos], no_sign_in: [slugs] }
async function standardize() {
  // a company that came in from anetix.ai and is not a paid site (nor being switched on right now) is a demo, whenever
  // it came in: the early ones were made before the flag existed
  const demos = (await q(
    `UPDATE platform.companies c SET demo=true FROM platform.self_serve s
      WHERE s.company=c.slug AND c.demo=false
        AND NOT EXISTS (SELECT 1 FROM platform.sites t WHERE t.company=c.slug AND (t.stage IN ('subscribed','activating') OR t.switched_on IS NOT NULL))
      RETURNING c.slug`)).rows.map((r) => r.slug);
  for (const slug of demos) console.log(`[standardize] ${slug}: came in from anetix.ai before demos were marked; it is a demo now, like every other`);
  // a company with no sign-in of its own is named every boot until an admin gives it one (it leans on the shared password
  // variables, and without them nobody can sign in to it); passwords are shown once, so they cannot be made up here
  const noSignIn = (await q(`SELECT a.company FROM platform.company_access a JOIN platform.companies c ON c.slug=a.company WHERE a.legacy_login`).catch(() => ({ rows: [] }))).rows.map((r) => r.company);
  for (const slug of noSignIn) console.warn(`[standardize] ${slug}: still on the shared passwords${process.env.SOS_FLOOR_PASSWORD || process.env.SOS_MANAGER_PASSWORD ? "" : ", which are gone, so nobody can sign in to it"}: give it its own on its card in /admin (Companies)`);
  if (demos.length) await logEvent("companies_standardized", "instance", { demos });
  forget();
  return { demos, no_sign_in: noSignIn };
}

module.exports = { isSite, isTrial, forget, standardize, SITE_STAGES };
