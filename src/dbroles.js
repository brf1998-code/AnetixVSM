// A database role per company and lane. Tenancy trade study of 2026-09-17,
// option C, the database half (the process half is src/runner.js).
//
// Until this, module code reached the database through `scopedDb`, which only
// sets a search_path on the platform's own connection: a convenience, not a
// wall. The 2026-09-18 review said so ("not a boundary while module code runs
// in-process with the platform's DATABASE_URL in reach"). Now each company has
// two roles, and its module code connects as one of them and as nothing else:
//
//   sos_<company>_live   the code a manager approved. Reads and writes the rows
//                        of the company's own LIVE module tables
//                        (mod_<company>_*). Nothing else: not the platform
//                        schema, not another company, no CREATE / ALTER / DROP /
//                        TRUNCATE, no files, no other role.
//   sos_<company>_stg    the code of a staged preview, which nobody has approved
//                        yet. Reads and writes the STAGING copy (stg_<company>_*)
//                        and may only READ the floor's tables (a preview of one
//                        tool reads its sibling tools' live rows through
//                        ctx.peer). So until the manager approves it, new code
//                        cannot change a row on the floor: the manager's gate
//                        holds at the database, not only in the pipeline.
//   sos_<company>_read   (2026-10-08, the assistant on the board, docs/ASSISTANT.md) SELECT only on the company's own
//                        LIVE module tables, never _migrations, never the platform schema, never another company.
//                        The assistant's record tools read through it inside a READ ONLY transaction, so "read only"
//                        and "its own company only" are held by Postgres, not just by the code in front of it. The
//                        company MCP (docs/MCP.md, phase 2) is to read through the same role. Not a module lane: no
//                        child process ever connects as it.
//
// The platform stays the owner of every schema and the only one that migrates,
// clones, snapshots and restores. Whenever it has made or remade tables
// (registry.mountLive / mountStaged, a restore) it calls grant() again, because
// a new table carries no rights for anyone but its owner. A module's
// _migrations bookkeeping table is closed to both roles.
//
// Passwords are never stored: each is an HMAC of the role's name under the
// instance's secret (SOS_CONNECTION_KEY, else SESSION_SECRET), set again at
// every boot, so a rotated secret heals itself.
//
// What only the instance can say: whether its database user may make roles,
// and whether a new role can sign in. selfTest() finds out at boot and says so
// in the log; src/runner.js decides what to do about it.
const crypto = require("crypto");
const { Client } = require("pg");
const { q } = require("./db");

const DATABASE_URL = process.env.DATABASE_URL || "postgres://sos:sos@localhost:5432/sos";
const ident = (s) => String(s).replace(/[^a-z0-9_]/gi, "_").toLowerCase();
const LANES = ["live", "staged"];
// The test floor (docs/TEST-ENVIRONMENT.md) is a third lane and a third role,
//   sos_<company>_tst   reads and writes the company's TEST tables (tst_<company>_*) and nothing else:
//                       not the floor, not a preview. Made the first time the company's test floor is
//                       switched on, dropped with the company. ALL_LANES is for stopping and dropping;
//                       LANES stays the two every company has from birth.
const TEST = "test";
const ALL_LANES = [...LANES, TEST];
const CONNECTION_LIMIT = Number(process.env.SOS_ROLE_CONNECTIONS || 12);
const STATEMENT_TIMEOUT = process.env.SOS_ROLE_STATEMENT_TIMEOUT || "30s";

// ---- pure ------------------------------------------------------------------------------------------
const READ = "read";
function roleName(company, lane) { return `sos_${ident(company)}_${lane === "staged" ? "stg" : lane === TEST ? "tst" : lane === READ ? "read" : "live"}`.slice(0, 63); }
function secret() { return process.env.SOS_CONNECTION_KEY || process.env.SESSION_SECRET || "sos-dev-secret-not-for-production"; }
// url-safe on purpose: it goes into a connection string and into ALTER ROLE as a literal
function passwordFor(role) { return crypto.createHmac("sha256", secret()).update(`sos-dbrole:${role}`).digest("base64url"); }
// The platform's own connection settings with the role's name and password in place of its own.
function connectionFor(company, lane, base = DATABASE_URL) {
  const u = new URL(base);
  const role = roleName(company, lane);
  return {
    host: u.hostname, port: Number(u.port || 5432), database: decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres",
    user: role, password: passwordFor(role),
    ssl: /railway|rlwy\.net|sslmode=require/.test(base) ? { rejectUnauthorized: false } : undefined,
  };
}
// The statements that give the roles their rights on one module's schemas. has: which of the schemas and
// bookkeeping tables exist right now ({ live, staged, test, liveMigrations, stagedMigrations, testMigrations }).
// The test role is named only when a test schema exists, so a company with the test floor off never gets a
// statement about it.
function grantStatements(company, mod, has) {
  const live = `mod_${ident(company)}_${ident(mod)}`, stg = `stg_${ident(company)}_${ident(mod)}`, tst = `tst_${ident(company)}_${ident(mod)}`;
  const L = roleName(company, "live"), S = roleName(company, "staged"), T = roleName(company, TEST), R = roleName(company, READ);
  const out = [];
  if (has.test) {
    out.push(`GRANT USAGE ON SCHEMA ${tst} TO ${T}`);
    out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${tst} TO ${T}`);
    out.push(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${tst} TO ${T}`);
    if (has.testMigrations) out.push(`REVOKE ALL ON ${tst}._migrations FROM ${T}`);
  }
  if (has.live) {
    out.push(`GRANT USAGE ON SCHEMA ${live} TO ${L}, ${S}`);
    out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${live} TO ${L}`);
    out.push(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${live} TO ${L}`);
    out.push(`GRANT SELECT ON ALL TABLES IN SCHEMA ${live} TO ${S}`);
    // a staging table is made LIKE the live one, so its serial columns draw from the FLOOR's sequence
    out.push(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${live} TO ${S}`);
    if (has.liveMigrations) out.push(`REVOKE ALL ON ${live}._migrations FROM ${L}, ${S}`);
    // the read role: the floor's rows, read only (the assistant's record tools)
    out.push(`GRANT USAGE ON SCHEMA ${live} TO ${R}`);
    out.push(`GRANT SELECT ON ALL TABLES IN SCHEMA ${live} TO ${R}`);
    if (has.liveMigrations) out.push(`REVOKE ALL ON ${live}._migrations FROM ${R}`);
  }
  if (has.staged) {
    out.push(`GRANT USAGE ON SCHEMA ${stg} TO ${S}`);
    out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${stg} TO ${S}`);
    out.push(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${stg} TO ${S}`);
    if (has.stagedMigrations) out.push(`REVOKE ALL ON ${stg}._migrations FROM ${S}`);
  }
  return out;
}

// ---- database ---------------------------------------------------------------------------------------
const state = { ok: null, reason: null, checked_at: null };
const ensured = new Set();

async function ensureRole(role) {
  const pw = passwordFor(role);   // base64url only: safe as a literal
  const attrs = `LOGIN PASSWORD '${pw}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION CONNECTION LIMIT ${CONNECTION_LIMIT}`;
  const has = (await q("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rows.length > 0;
  await q(`${has ? "ALTER" : "CREATE"} ROLE ${role} WITH ${attrs}`);
  await q(`ALTER ROLE ${role} SET statement_timeout = '${String(STATEMENT_TIMEOUT).replace(/[^0-9a-z]/gi, "")}'`);
  await q(`ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '60s'`);
}
async function ensureCompany(company) {
  if (ensured.has(company)) return;
  for (const lane of [...LANES, READ]) await ensureRole(roleName(company, lane));
  ensured.add(company);
}
// Call after the platform made or remade tables for this module (mount, staging clone, restore).
async function ensureTestRole(company) {
  if (ensured.has(`${company}/${TEST}`)) return;
  await ensureRole(roleName(company, TEST));
  ensured.add(`${company}/${TEST}`);
}
async function grant(company, mod) {
  if (state.ok === false) return { skipped: state.reason };
  await ensureCompany(company);
  const live = `mod_${ident(company)}_${ident(mod)}`, stg = `stg_${ident(company)}_${ident(mod)}`, tst = `tst_${ident(company)}_${ident(mod)}`;
  const schemas = new Set((await q("SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])", [[live, stg, tst]])).rows.map((r) => r.nspname));
  const migs = new Set((await q("SELECT schemaname FROM pg_tables WHERE tablename='_migrations' AND schemaname = ANY($1::text[])", [[live, stg, tst]])).rows.map((r) => r.schemaname));
  if (schemas.has(tst)) await ensureTestRole(company);   // the third role exists only once a company has a test floor
  const stmts = grantStatements(company, mod, { live: schemas.has(live), staged: schemas.has(stg), test: schemas.has(tst), liveMigrations: migs.has(live), stagedMigrations: migs.has(stg), testMigrations: migs.has(tst) });
  for (const s of stmts) await q(s);
  return { statements: stmts.length };
}
async function dropCompany(company) {
  ensured.delete(company);
  ensured.delete(`${company}/${TEST}`);
  for (const lane of [...ALL_LANES, READ]) {
    const role = roleName(company, lane);
    try {
      if (!(await q("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rows.length) continue;
      await q(`DROP OWNED BY ${role}`);
      await q(`DROP ROLE ${role}`);
    } catch (e) { console.error(`[roles] could not drop ${role}: ${e.message}`); }
  }
}

// Can this instance do it at all? Makes a probe company's roles and a probe schema, signs in as the role, and
// checks both halves: its own table answers, the platform's does not. Never throws.
async function selfTest() {
  const probe = "zz_probe", schema = `mod_${probe}_t`;
  const done = (ok, reason) => { Object.assign(state, { ok, reason: reason || null, checked_at: new Date().toISOString() }); return { ...state }; };
  try {
    // nobody but the platform makes tables in the shared schema (the default before Postgres 15 let anyone)
    await q("REVOKE CREATE ON SCHEMA public FROM PUBLIC").catch(() => {});
    state.ok = null;
    try { await ensureCompany(probe); } catch (e) { return done(false, `the platform's database user may not make roles (${e.message})`); }
    await q(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await q(`CREATE TABLE IF NOT EXISTS ${schema}.t (x INT)`);
    await grant(probe, "t");
    const c = new Client({ ...connectionFor(probe, "live"), connectionTimeoutMillis: 8000 });
    try { await c.connect(); } catch (e) { return done(false, `a company role cannot sign in to the database (${e.message})`); }
    try {
      await c.query(`SELECT count(*) FROM ${schema}.t`);
      let leaked = false;
      try { await c.query("SELECT 1 FROM platform.companies LIMIT 1"); leaked = true; } catch (e) { if (e.code !== "42501") throw e; }
      if (leaked) return done(false, "a company role could read the platform's own tables");
      let made = false;
      try { await c.query(`CREATE TABLE ${schema}.evil (x INT)`); made = true; } catch (e) { if (e.code !== "42501") throw e; }
      if (made) return done(false, "a company role could make tables");
    } finally { await c.end().catch(() => {}); }
    return done(true);
  } catch (e) { return done(false, `the database role check failed (${e.message})`); }
  finally {
    await q(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await dropCompany(probe).catch(() => {});
  }
}

module.exports = { roleName, passwordFor, connectionFor, grantStatements, ensureCompany, ensureTestRole, grant, dropCompany, selfTest, state, LANES, ALL_LANES, TEST, READ };
