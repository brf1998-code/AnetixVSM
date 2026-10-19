// The tool library across companies (2026-10-19). Brendan: "Can all templates from other companies be searchable ...
// put them into demo companies to make the example apparent ... send out a custom sample module for them, so for
// example a CRM module that we have in the Anetix company then also a production dashboard that we have in another
// one ... a global that shows all tools that are just the framework, then we can make a standard package of tooling."
//
// Three things, all admin only, all on the Library tab of /admin (and the company card's Add a tool):
//   1. Copy a tool from any company to any other: the version on the floor (else the preview) becomes version 1 at
//      the new company, live, with EMPTY tables. Only the code travels (the Terms: Anetix owns the modules, the
//      company owns its data). Rows travel only if a migration file itself inserts them, and the check says so.
//   2. Templates: a frozen copy of a tool, kept here, apart from the company that made it. "Just the framework": a
//      template does not change when its source company keeps building, and it survives that company's deletion.
//   3. The standard package: the templates marked standard. One button on a company card adds every one of them.
//
// Before anything leaves its company, `check` reads every file for what is that company's own: its name, email
// addresses and phone numbers, rows a migration would insert, other tools it reads (ctx.peer), outside connections.
// The admin sees the list before confirming, and a template keeps the list it was saved with. Address paths
// (/c/<from>/ and /m/<old name>/) are rewritten to the new company on every copy, so they are reported, not left.
//
// What a copy does not bring: the source's outside connection switches (turned on per tool, src/connections.js),
// its feedback, builds, record, agent docs other than the module's own reference, and its brand (a company with a
// finished brand guide gets a restyle build, the same as a library tool added from the repo).
const express = require("express");
const { q, logEvent, upsertDoc } = require("./db");
const registry = require("./registry");
const migrate = require("./migrate");
const gate = require("./modulegate");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS platform.library_templates (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  name          TEXT NOT NULL,                    -- the tool's address name at the company it came from
  files         JSONB NOT NULL,
  from_company  TEXT,
  from_name     TEXT,                             -- the company's display name when it was saved (the company may go)
  from_version  INTEGER,
  standard      BOOLEAN NOT NULL DEFAULT false,
  findings      JSONB NOT NULL DEFAULT '[]'::jsonb, -- what the check found when it was saved
  saved_by      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS platform.library_copies (
  id            SERIAL PRIMARY KEY,
  company       TEXT NOT NULL,
  module        TEXT NOT NULL,
  template_id   INTEGER,
  from_company  TEXT,
  from_module   TEXT,
  from_version  INTEGER,
  by            TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS library_copies_company ON platform.library_copies (company);
`;
async function init() { await q(SCHEMA); }

const fail = (status, msg) => Object.assign(new Error(msg), { status });
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// words too common to flag as a company's own name
const GENERIC = new Set(["demo", "test", "company", "inc", "llc", "corp", "current", "the"]);

// ---- the check (pure) ----------------------------------------------------------------------------------
// files: { path: text }. company: { slug, name }. name: the tool's address name.
// -> [{ kind, label, file, count, sample }], most serious first.
function check(files, company, name) {
  const out = [];
  const add = (kind, label, file, count, sample) => out.push({ kind, label, file, count, sample: sample ? String(sample).replace(/\s+/g, " ").trim().slice(0, 160) : "" });
  const around = (text, i, len) => text.slice(Math.max(0, i - 50), i + len + 50);
  const names = new Set();
  const display = String((company && company.name) || "").trim();
  if (display.length >= 4 && !GENERIC.has(display.toLowerCase())) names.add(display);
  // each long word of the name on its own too ("Chelsea Clock" -> "Chelsea"), so "Chelsea parts" is caught
  for (const w of display.split(/[^A-Za-z0-9']+/)) if (w.length >= 5 && !GENERIC.has(w.toLowerCase())) names.add(w);
  const slug = String((company && company.slug) || "");
  for (const [file, text] of Object.entries(files || {})) {
    if (typeof text !== "string") continue;
    for (const n of names) {
      const re = new RegExp(`\\b${reEsc(n)}\\b`, "gi");
      const hits = [...text.matchAll(re)];
      if (hits.length) add("name", `names "${n}"`, file, hits.length, around(text, hits[0].index, n.length));
    }
    const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].filter((m) => !/@(example\.(com|org)|anetix\.ai)$/i.test(m[0]));
    if (emails.length) add("contact", "an email address", file, emails.length, emails[0][0]);
    const phones = [...text.matchAll(/(?<![\d.])\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g)];
    if (phones.length) add("contact", "a phone number", file, phones.length, phones[0][0]);
    if (/^migrations\/.*\.sql$/.test(file)) {
      const ins = [...text.matchAll(/\b(INSERT\s+INTO|COPY\s+\w+)/gi)];
      if (ins.length) add("rows", "puts rows in its tables (they travel with the copy)", file, ins.length, around(text, ins[0].index, 40));
    }
    if (/\.js$/.test(file)) {
      const peers = [...new Set([...text.matchAll(/\bpeer\(\s*["'`]([a-z0-9-]+)["'`]/g)].map((m) => m[1]))].filter((p) => p !== name);
      if (peers.length) add("peer", `reads another tool: ${peers.join(", ")} (shows nothing unless that tool is at the new company under the same name)`, file, peers.length, "");
      if (/\bconnections\s*\.\s*(erp|printer|sheet|spreadsheet|web)\b/.test(text)) add("outside", "reaches an outside system (switched on per tool; off at the new company until Anetix turns it on)", file, 1, "");
    }
    if (slug) {
      const paths = [...text.matchAll(new RegExp(`/c/${reEsc(slug)}/`, "g"))];
      if (paths.length) add("path", `addresses at /c/${slug}/ (rewritten to the new company)`, file, paths.length, "");
    }
  }
  const order = { name: 0, contact: 1, rows: 2, peer: 3, outside: 4, path: 5 };
  return out.sort((a, b) => order[a.kind] - order[b.kind] || a.file.localeCompare(b.file));
}

// Rewrite a tool's own addresses for its new home. Pure.
function rewrite(files, { fromCompany, fromName, toCompany, toName, title }) {
  const out = {};
  for (const [file, text] of Object.entries(files || {})) {
    if (typeof text !== "string") { out[file] = text; continue; }
    let t = text;
    if (fromCompany && toCompany && fromCompany !== toCompany) t = t.split(`/c/${fromCompany}/`).join(`/c/${toCompany}/`);
    if (fromName && toName && fromName !== toName) t = t.replace(new RegExp(`/m/${reEsc(fromName)}(?=[/"'\`?#])`, "g"), `/m/${toName}`);
    out[file] = t;
  }
  if (out["module.json"]) {
    try {
      const mf = JSON.parse(out["module.json"]);
      delete mf.company;   // a repo field naming the library's own company; never carried
      if (title) mf.title = title;
      out["module.json"] = JSON.stringify(mf, null, 2) + "\n";
    } catch (e) { /* an agent-written manifest that does not parse: left as it is, the gate below says so */ }
  }
  return out;
}

// ---- reads ---------------------------------------------------------------------------------------------
async function companyRow(slug) { return (await q("SELECT slug, name FROM platform.companies WHERE slug=$1", [slug])).rows[0]; }

// The version a copy takes: the floor's, else the preview's, else the newest.
async function sourceOf(company, mod) {
  const row = await registry.getModule(company, mod);
  if (!row) throw fail(404, `no tool ${mod} at ${company}`);
  let version = row.live_version || row.staged_version;
  if (!version) version = Number((await q("SELECT max(version) AS v FROM platform.module_versions WHERE company=$1 AND module=$2", [company, mod])).rows[0].v) || null;
  const files = version ? await registry.versionFiles(company, mod, version) : null;
  if (!files || !files["module.json"]) throw fail(409, `${mod} at ${company} has no version to copy yet`);
  return { row, version, files };
}

function manifestOf(files) { try { return JSON.parse(files["module.json"]); } catch (e) { return {}; } }

async function list() {
  const rows = (await q(`SELECT t.id, t.title, t.description, t.name, t.from_company, t.from_name, t.from_version, t.standard, t.findings, t.saved_by,
      t.created_at, t.updated_at, t.files->>'module.json' AS manifest,
      (SELECT count(*)::int FROM jsonb_object_keys(t.files) k WHERE k LIKE 'migrations/%.sql') AS migrations,
      (SELECT coalesce(json_agg(json_build_object('company', c.company, 'module', c.module, 'at', c.created_at) ORDER BY c.created_at), '[]') FROM platform.library_copies c
        WHERE c.template_id = t.id AND EXISTS (SELECT 1 FROM platform.modules m WHERE m.company=c.company AND m.name=c.module)) AS copies
    FROM platform.library_templates t ORDER BY t.standard DESC, lower(t.title)`)).rows;
  return rows.map((r) => {
    let mf = {}; try { mf = JSON.parse(r.manifest || "{}"); } catch (e) { /* shown without screens */ }
    let screens = []; try { screens = registry.pageEntries(mf); } catch (e) { /* agent-written manifest */ }
    const { manifest, ...rest } = r;
    return { ...rest, screens, smoke: (mf.smoke || []).length };
  });
}

// ---- writes --------------------------------------------------------------------------------------------
// Put files into a company as a new tool, version 1, live. Returns { module, version }.
async function addFiles(toCompany, files, { name, title, notes, by, templateId = null, from = {} }) {
  const co = await companyRow(toCompany);
  if (!co) throw fail(404, "unknown company");
  // the address name: the tool's own, else -2, -3 ... where it is taken here, or its tables would be someone else's,
  // or it is the name of a repo library tool (the boot import would then try to bring the repo copy over it)
  const repoNames = new Set(registry.libraryModules().map((m) => m.name));
  const base = String(name || "tool").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30).replace(/-+$/g, "") || "tool";
  let mod = null;
  for (let i = 1; i < 60 && !mod; i++) {
    const s = i === 1 ? base : `${base.slice(0, 30 - String(i).length - 1).replace(/-+$/, "")}-${i}`;
    if (repoNames.has(s) || (await registry.getModule(co.slug, s)) || (await migrate.schemaClash(co.slug, s))) continue;
    mod = s;
  }
  if (!mod) throw fail(409, `could not find a free name for ${base} at ${co.name}`);
  const fixed = rewrite(files, { fromCompany: from.company, fromName: from.module || name, toCompany: co.slug, toName: mod, title });
  // the module gate holds a copy to the rule a new build is held to: it is new code on this company's floor
  const verdict = gate.check({ files: fixed, lane: null });
  if (!verdict.ok) throw Object.assign(fail(422, `This tool's code would be refused as a new build today, so it cannot be copied: ${gate.oneLine(verdict)}. Have it rebuilt at its own company first.`), { problems: verdict.violations });
  const mf = manifestOf(fixed);
  await q("INSERT INTO platform.modules (company, name, title, live_version) VALUES ($1,$2,$3,1)", [co.slug, mod, mf.title || title || mod]);
  try {
    await q(`INSERT INTO platform.module_versions (company, module, version, source, notes, files) VALUES ($1,$2,1,'copy',$3,$4)`,
      [co.slug, mod, notes, JSON.stringify(fixed)]);
    await registry.mountLiveIfNeeded(co.slug, mod, 1);   // materializes the files, builds its (empty) tables, mounts it
  } catch (e) {
    // nothing half made: the rows go, and the tables if the migrations got that far
    await q("DELETE FROM platform.module_versions WHERE company=$1 AND module=$2", [co.slug, mod]).catch(() => {});
    await q("DELETE FROM platform.modules WHERE company=$1 AND name=$2", [co.slug, mod]).catch(() => {});
    await q(`DROP SCHEMA IF EXISTS ${migrate.liveSchema(co.slug, mod)} CASCADE`).catch(() => {});
    throw fail(422, `The copy could not be put on ${co.name}'s floor: ${e.message}`);
  }
  if (fixed["reference.md"]) await upsertDoc(co.slug, mod, "reference.md", fixed["reference.md"], "copy", true).catch(() => {});
  for (const a of Object.values(mf.agents || {})) if (a && a.doc && fixed[a.doc]) await upsertDoc(co.slug, mod, a.doc, fixed[a.doc], "copy", true).catch(() => {});
  await q("INSERT INTO platform.library_copies (company, module, template_id, from_company, from_module, from_version, by) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [co.slug, mod, templateId, from.company || null, from.module || null, from.version || null, by || null]);
  require("./modprice").changed(co.slug);   // live from the start, like a library tool: a site priced by the tool pays for it
  await require("./testfloor").afterModuleAdded(co.slug, mod, 1).catch((e) => console.error(`[library] test floor ${co.slug}/${mod}:`, e.message));
  await logEvent("module_copied", `${co.slug}/${mod}`, { template_id: templateId, from, by });
  await require("./record").record("tool_copied", { company: co.slug, module: mod, actor: "anetix", after: notes, detail: { template_id: templateId, from } }).catch(() => {});
  let restyle = null;
  const brandRow = (await q("SELECT brand FROM platform.companies WHERE slug=$1", [co.slug])).rows[0];
  if (brandRow && brandRow.brand && brandRow.brand.status === "done") {
    try { restyle = (await require("./brand").restyleModule(co.slug, mod)).id; } catch (e) { console.error(`[library] restyle ${co.slug}/${mod}:`, e.message); }
  }
  return { module: mod, version: 1, title: mf.title || title || mod, renamed: mod !== base, restyle_run: restyle };
}

async function copyTool({ fromCompany, module: mod, toCompany, by }) {
  const from = await companyRow(fromCompany);
  if (!from) throw fail(404, "unknown company to copy from");
  const src = await sourceOf(from.slug, mod);
  const mf = manifestOf(src.files);
  return addFiles(toCompany, src.files, {
    name: mod, title: mf.title || src.row.title, by,
    notes: `copied from ${from.name} (${from.slug}/${mod} v${src.version})`,
    from: { company: from.slug, module: mod, version: src.version },
  });
}

async function saveTemplate({ fromCompany, module: mod, title, description, standard, by }) {
  const from = await companyRow(fromCompany);
  if (!from) throw fail(404, "unknown company");
  const src = await sourceOf(from.slug, mod);
  const mf = manifestOf(src.files);
  const t = String(title || mf.title || src.row.title).trim().slice(0, 120);
  const d = String(description != null ? description : mf.description || "").trim().slice(0, 1000);
  // a template's own manifest carries its title and what it does; the source company's paths stay until a copy
  const files = rewrite(src.files, { title: t });
  if (d) { try { const m = JSON.parse(files["module.json"]); m.description = d; files["module.json"] = JSON.stringify(m, null, 2) + "\n"; } catch (e) { /* left */ } }
  const findings = check(files, from, mod);
  const r = (await q(`INSERT INTO platform.library_templates (title, description, name, files, from_company, from_name, from_version, standard, findings, saved_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
  [t, d, mod, JSON.stringify(files), from.slug, from.name, src.version, Boolean(standard), JSON.stringify(findings), by || null])).rows[0];
  await logEvent("template_saved", `${from.slug}/${mod}`, { id: r.id, version: src.version, findings: findings.length, by });
  return { id: r.id, findings };
}

async function addTemplate(id, toCompany, by) {
  const t = (await q("SELECT * FROM platform.library_templates WHERE id=$1", [id])).rows[0];
  if (!t) throw fail(404, "no such template");
  return addFiles(toCompany, t.files, {
    name: t.name, title: t.title, by, templateId: t.id,
    notes: `from the template "${t.title}" (saved from ${t.from_name || t.from_company} ${t.name} v${t.from_version})`,
    from: { company: t.from_company, module: t.name, version: t.from_version },
  });
}

// Several templates into one company: a sample package for a prospect, or the standard package. Each one on its
// own: one that fails is reported and the rest still go. A template this company already has a live copy of is
// skipped unless `again`.
async function addPackage(toCompany, { ids = [], standard = false, again = false, by }) {
  let want = (ids || []).map(Number).filter(Boolean);
  if (standard) want = want.concat((await q("SELECT id FROM platform.library_templates WHERE standard ORDER BY lower(title)")).rows.map((r) => r.id));
  want = [...new Set(want)];
  if (!want.length) throw fail(400, standard ? "no template is in the standard package yet" : "pick at least one template");
  const have = new Set((await q(`SELECT c.template_id FROM platform.library_copies c JOIN platform.modules m ON m.company=c.company AND m.name=c.module
    WHERE c.company=$1 AND c.template_id IS NOT NULL`, [toCompany])).rows.map((r) => r.template_id));
  const results = [];
  for (const id of want) {
    if (have.has(id) && !again) { results.push({ id, skipped: "already there" }); continue; }
    try { results.push({ id, ok: true, ...(await addTemplate(id, toCompany, by)) }); }
    catch (e) { results.push({ id, error: e.message }); }
  }
  return { results, added: results.filter((r) => r.ok).length };
}

// ---- routes --------------------------------------------------------------------------------------------
const router = express.Router();
const json = express.json({ limit: "1mb" });
const requireAdmin = (req, res, next) => require("./auth").requireAdmin(req, res, next);
const guard = (fn) => async (req, res) => { try { await fn(req, res); } catch (e) { res.status(e.status || 500).json({ error: e.message, problems: e.problems }); } };
const who = (req) => (req.sosAccount && (req.sosAccount.name || req.sosAccount.login)) || "admin";

router.get("/api/admin/library/templates", requireAdmin, guard(async (_req, res) => res.json({ templates: await list() })));
// what is that company's own in a tool, before it leaves (the copy and save dialogs show it)
router.get("/api/admin/library/check", requireAdmin, guard(async (req, res) => {
  const co = await companyRow(String(req.query.company || ""));
  if (!co) throw fail(404, "unknown company");
  const src = await sourceOf(co.slug, String(req.query.module || ""));
  const mf = manifestOf(src.files);
  res.json({ company: co, module: src.row.name, title: mf.title || src.row.title, description: mf.description || "", version: src.version,
    live: src.version === src.row.live_version, files: Object.keys(src.files).length, findings: check(src.files, co, src.row.name) });
}));
router.post("/api/admin/library/copy", requireAdmin, json, guard(async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, ...(await copyTool({ fromCompany: b.from_company, module: b.module, toCompany: b.to_company, by: who(req) })) });
}));
router.post("/api/admin/library/templates", requireAdmin, json, guard(async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, ...(await saveTemplate({ fromCompany: b.from_company, module: b.module, title: b.title, description: b.description, standard: b.standard, by: who(req) })) });
}));
router.patch("/api/admin/library/templates/:id", requireAdmin, json, guard(async (req, res) => {
  const b = req.body || {}, sets = [], vals = [Number(req.params.id)];
  if (b.title != null) { vals.push(String(b.title).trim().slice(0, 120)); sets.push(`title=$${vals.length}`); }
  if (b.description != null) { vals.push(String(b.description).trim().slice(0, 1000)); sets.push(`description=$${vals.length}`); }
  if (b.standard != null) { vals.push(Boolean(b.standard)); sets.push(`standard=$${vals.length}`); }
  if (!sets.length) throw fail(400, "nothing to change");
  const r = await q(`UPDATE platform.library_templates SET ${sets.join(", ")}, updated_at=now() WHERE id=$1 RETURNING id`, vals);
  if (!r.rowCount) throw fail(404, "no such template");
  await logEvent("template_changed", String(req.params.id), { ...b, by: who(req) });
  res.json({ ok: true });
}));
// deleting a template never touches the companies that already have a copy of it
router.delete("/api/admin/library/templates/:id", requireAdmin, guard(async (req, res) => {
  const r = await q("DELETE FROM platform.library_templates WHERE id=$1", [Number(req.params.id)]);
  if (!r.rowCount) throw fail(404, "no such template");
  await logEvent("template_deleted", String(req.params.id), { by: who(req) });
  res.json({ ok: true });
}));
router.post("/api/admin/library/templates/:id/add", requireAdmin, json, guard(async (req, res) => {
  res.json({ ok: true, ...(await addTemplate(Number(req.params.id), String((req.body || {}).to_company || ""), who(req))) });
}));
router.post("/api/admin/companies/:slug/package", requireAdmin, json, guard(async (req, res) => {
  const b = req.body || {};
  res.json({ ok: true, ...(await addPackage(req.params.slug, { ids: b.ids, standard: Boolean(b.standard), again: Boolean(b.again), by: who(req) })) });
}));

// a company deleted: its copy history goes; templates saved from it stay (they are Anetix's, apart from the company)
async function deleteCompany(slug) { await q("DELETE FROM platform.library_copies WHERE company=$1", [slug]); }

module.exports = { init, router, check, rewrite, list, copyTool, saveTemplate, addTemplate, addPackage, deleteCompany };
