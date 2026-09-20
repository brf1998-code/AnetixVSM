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
const CONNECTION_LIMIT = Number(process.env.SOS_ROLE_CONNECTIONS || 12);
const STATEMENT_TIMEOUT = process.env.SOS_ROLE_STATEMENT_TIMEOUT || "30s";

// ---- pure ------------------------------------------------------------------------------------------
function roleName(company, lane) { return `sos_${ident(company)}_${lane === "staged" ? "stg" : "live"}`.slice(0, 63); }
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
// The statements that give the two roles their rights on one module's schemas. has: which of the schemas and
// bookkeeping tables exist right now ({ live, staged, liveMigrations, stagedMigrations }).
function grantStatements(company, mod, has) {
  const live = `mod_${ident(company)}_${ident(mod)}`, stg = `stg_${ident(company)}_${ident(mod)}`;
  const L = roleName(company, "live"), S = roleName(company, "staged");
  const out = [];
  if (has.live) {
    out.push(`GRANT USAGE ON SCHEMA ${live} TO ${L}, ${S}`);
    out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${live} TO ${L}`);
    out.push(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${live} TO ${L}`);
    out.push(`GRANT SELECT ON ALL TABLES IN SCHEMA ${live} TO ${S}`);
    // a staging table is made LIKE the live one, so its serial columns draw from the FLOOR's sequence
    out.push(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${live} TO ${S}`);
    if (has.liveMigrations) out.push(`REVOKE ALL ON ${live}._migrations FROM ${L}, ${S}`);
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
  for (const lane of LANES) await ensureRole(roleName(company, lane));
  ensured.add(company);
}
// Call after the platform made or remade tables for this module (mount, staging clone, restore).
async function grant(company, mod) {
  if (state.ok === false) return { skipped: state.reason };
  await ensureCompany(company);
  const live = `mod_${ident(company)}_${ident(mod)}`, stg = `stg_${ident(company)}_${ident(mod)}`;
  const schemas = new Set((await q("SELECT nspname FROM pg_namespace WHERE nspname = ANY($1::text[])", [[live, stg]])).rows.map((r) => r.nspname));
  const migs = new Set((await q("SELECT schemaname FROM pg_tables WHERE tablename='_migrations' AND schemaname = ANY($1::text[])", [[live, stg]])).rows.map((r) => r.schemaname));
  const stmts = grantStatements(company, mod, { live: schemas.has(live), staged: schemas.has(stg), liveMigrations: migs.has(live), stagedMigrations: migs.has(stg) });
  for (const s of stmts) await q(s);
  return { statements: stmts.length };
}
async function dropCompany(company) {
  ensured.delete(company);
  for (const lane of LANES) {
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

module.exports = { roleName, passwordFor, connectionFor, grantStatements, ensureCompany, grant, dropCompany, selfTest, state, LANES };
